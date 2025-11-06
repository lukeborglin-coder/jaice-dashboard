from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import io
import logging
import re
from typing import List, Optional, Dict, Any
from statsmodels.discrete.discrete_model import MNLogit
import statsmodels.api as sm
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Conjoint Analysis API",
    version="0.4.0",
    description="API for conjoint analysis estimation and market share simulation"
)

# CORS Configuration - Update origins for production
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3005",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3005",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
MAX_FILE_SIZE_MB = 50  # Maximum file size in MB
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# -------- Pydantic Models --------
class SchemaAttr(BaseModel):
    name: str
    levels: List[str]
    reference: Optional[str] = None
    label: Optional[str] = None

class EstimateResponse(BaseModel):
    intercept: float
    utilities: Dict[str, Dict[str, float]]
    columns: List[str]
    schema: Dict[str, List[SchemaAttr]]
    diagnostics: Optional[Dict[str, Any]] = None

class SimulateRequest(BaseModel):
    intercept: float
    utilities: Dict[str, Dict[str, float]]
    scenarios: List[Dict[str, str]]
    rule: str = "logit"

class SimulateResponse(BaseModel):
    utilities: List[float]
    shares: List[float]

class MarketShareScenario(BaseModel):
    scenario_name: str
    products: List[Dict[str, Any]]  # List of products with their market shares
    total_share: float

class ScenarioAnalysisRequest(BaseModel):
    intercept: float
    utilities: Dict[str, Dict[str, float]]
    original_market_shares: List[Dict[str, Any]]  # Current market shares
    new_scenarios: List[Dict[str, str]]  # New product scenarios
    rule: str = "logit"
    with_new_options_columns: Optional[List[Any]] = None  # Column metadata for "with new options" data
    survey_data_rows: Optional[List[Any]] = None  # Raw survey data rows
    attribute_columns: Optional[List[str]] = None  # Attribute column names for matching scenarios
    schema: Optional[Any] = None  # Schema for attribute mapping
    design_matrix: Optional[List[Dict[str, Any]]] = None  # Design matrix for task-to-scenario matching
    column_mapping: Optional[Dict[str, Any]] = None  # Column mapping including attributeColumnMapping

class ScenarioAnalysisResponse(BaseModel):
    original_scenario: MarketShareScenario
    projected_scenarios: List[MarketShareScenario]
    market_impact: Dict[str, Any]  # Analysis of market changes
    diagnostics: Optional[Dict[str, Any]] = None

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str

# -------- Utility Functions --------
def utilities_attrs(utilities: Dict[str, Dict[str, float]]):
    """Generator that yields attribute names from utilities dict"""
    for k in utilities.keys():
        yield k

def effect_code(series: pd.Series, levels: List[str], reference: Optional[str] = None) -> pd.DataFrame:
    """
    Apply effects coding to a categorical series.

    Effects coding represents categorical variables where:
    - Each non-reference level gets a dummy variable
    - Reference level is coded as -1 across all dummies

    Args:
        series: Categorical data series
        levels: All possible levels for this attribute
        reference: Reference level (defaults to last level if not specified)

    Returns:
        DataFrame with effect-coded columns
    """
    if reference is None:
        reference = levels[-1]

    series = series.astype(str)
    series = series.where(series.isin(levels), other=reference)
    cats = [lvl for lvl in levels if lvl != reference]
    out = pd.DataFrame(0.0, index=series.index, columns=[f"{series.name}__{c}" for c in cats])

    for c in cats:
        out.loc[series == c, f"{series.name}__{c}"] = 1.0

    ref_mask = (series == reference)
    out.loc[ref_mask, :] = -1.0

    return out

def build_design_matrix(df: pd.DataFrame, attributes: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Build design matrix from data and attribute definitions using effects coding.

    Args:
        df: Data frame containing attribute columns
        attributes: List of attribute definitions with names, levels, and optional references

    Returns:
        Design matrix with constant and effect-coded attributes
    """
    X_parts = []
    for attr in attributes:
        name = attr["name"]
        levels = attr["levels"]
        ref = attr.get("reference")

        if name not in df.columns:
            raise ValueError(f"Attribute column missing in data: {name}")

        X_parts.append(effect_code(df[name].astype(str), levels, ref))

    X = pd.concat(X_parts, axis=1)
    X = sm.add_constant(X, has_constant="add")

    return X

def parse_definitions_sheet(df_defs: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Parse attribute definitions from Excel sheet.

    Expected columns:
    - name: Attribute name
    - type: Must be 'categorical'
    - levels: Comma-separated list of levels
    - reference: (optional) Reference level for effects coding

    Args:
        df_defs: DataFrame from definitions sheet

    Returns:
        List of attribute definitions
    """
    # Normalize headers
    df_defs = df_defs.rename(columns={str(c).strip().lower(): str(c).strip().lower() for c in df_defs.columns})

    if "name" not in df_defs.columns:
        raise ValueError("Definitions must include a 'name' column.")
    if "type" not in df_defs.columns:
        raise ValueError("Definitions must include a 'type' column (must be 'categorical').")
    if "levels" not in df_defs.columns:
        raise ValueError("Definitions must include a 'levels' column (comma-separated).")

    attributes = []
    for _, row in df_defs.iterrows():
        name = str(row.get("name")).strip()
        typ = str(row.get("type", "categorical")).strip().lower()
        levels_raw = row.get("levels", "")
        reference = row.get("reference", None)

        if not name or name.lower() == "nan":
            continue

        if typ != "categorical":
            raise ValueError(f"Only categorical attributes supported. Offending attribute: '{name}' (type='{typ}').")

        if not isinstance(levels_raw, str) or not levels_raw.strip():
            raise ValueError(f"Attribute '{name}' must list levels (comma-separated).")

        levels = [s.strip() for s in levels_raw.split(",") if s.strip()]
        if len(levels) < 2:
            raise ValueError(f"Attribute '{name}' must have at least 2 levels.")

        ref = None if pd.isna(reference) else str(reference).strip()
        if ref and ref not in levels:
            raise ValueError(f"Attribute '{name}' reference '{ref}' is not in its levels.")

        attributes.append({"name": name, "levels": levels, "reference": ref})

    return attributes

def calculate_market_impact(original_shares: List[float], projected_shares: List[float]) -> Dict[str, Any]:
    """
    Calculate market impact metrics between original and projected scenarios.
    
    Args:
        original_shares: List of original market shares
        projected_shares: List of projected market shares
        
    Returns:
        Dictionary with impact metrics
    """
    if len(original_shares) != len(projected_shares):
        raise ValueError("Original and projected shares must have same length")
    
    # Calculate changes
    changes = [proj - orig for orig, proj in zip(original_shares, projected_shares)]
    
    # Calculate metrics
    total_change = sum(changes)
    max_increase = max(changes) if changes else 0
    max_decrease = min(changes) if changes else 0
    
    # Calculate market concentration (Herfindahl-Hirschman Index)
    original_hhi = sum(share ** 2 for share in original_shares)
    projected_hhi = sum(share ** 2 for share in projected_shares)
    
    return {
        "total_market_change": total_change,
        "max_increase": max_increase,
        "max_decrease": max_decrease,
        "original_hhi": original_hhi,
        "projected_hhi": projected_hhi,
        "concentration_change": projected_hhi - original_hhi,
        "individual_changes": changes
    }

def normalize_market_shares(shares: List[float]) -> List[float]:
    """
    Normalize market shares to sum to 1.0.
    
    Args:
        shares: List of market shares
        
    Returns:
        Normalized shares
    """
    total = sum(shares)
    if total == 0:
        return [0.0] * len(shares)
    return [share / total for share in shares]

def use_with_new_options_data(
    new_scenario: Dict[str, str],
    with_new_options_columns: List[Dict[str, Any]],
    survey_data_rows: List[Dict[str, Any]],
    attribute_columns: List[str],
    original_products: List[Dict[str, Any]],
    utilities: Dict[str, Dict[str, float]],
    schema: Optional[Dict[str, Any]] = None
) -> tuple:
    """
    Use actual "withNewOptions" survey data to calculate projected market shares.
    
    Aggregates the "withNewOptions" market share data from all respondents across all tasks
    to calculate how market shares change when new products are introduced.
    
    Args:
        new_scenario: New product scenario with attribute-level pairs (not currently used for matching)
        with_new_options_columns: Column metadata for "withNewOptions" data
        survey_data_rows: Raw survey data rows from respondents
        attribute_columns: List of attribute column names for matching (not currently used)
        original_products: List of existing products with names/rowNumbers
        utilities: Estimated utilities for matching (not currently used)
        schema: Optional schema for attribute mapping (not currently used)
        
    Returns:
        Tuple of (projected_shares, matching_tasks_used) or (None, []) if no data available
    """
    logger.info(f"[use_with_new_options_data] Starting with {len(with_new_options_columns)} columns, {len(survey_data_rows)} rows, {len(original_products)} products")
    
    if not survey_data_rows or not with_new_options_columns:
        logger.warning("[use_with_new_options_data] Missing required data: survey_data_rows={}, with_new_options_columns={}".format(
            bool(survey_data_rows), bool(with_new_options_columns)
        ))
        return None, []
    
    if not original_products:
        logger.warning("[use_with_new_options_data] No original products provided")
        return None, []
    
    # Group columns by task number
    columns_by_task = {}
    for col_info in with_new_options_columns:
        task_num = col_info.get('taskNumber', 1)
        if task_num not in columns_by_task:
            columns_by_task[task_num] = []
        columns_by_task[task_num].append(col_info)
    
    # Use all tasks that have "withNewOptions" data
    # We aggregate across all tasks since we don't have perfect scenario-to-task matching yet
    matching_tasks = list(columns_by_task.keys())
    
    if not matching_tasks:
        logger.warning("[use_with_new_options_data] No matching tasks found in withNewOptions columns")
        return None, []
    
    logger.info(f"[use_with_new_options_data] Using {len(matching_tasks)} task(s) for aggregation")
    
    # Aggregate market shares across all matching tasks and respondents
    product_shares = {}  # product_name -> list of share values
    product_row_map = {p.get('rowNumber'): p.get('name') for p in original_products}
    
    # Initialize product shares for all known products
    for product in original_products:
        product_name = product.get('name')
        if product_name:
            product_shares[product_name] = []
    
    # Track all products found in the data (including potential new products)
    all_products_in_data = set()
    
    # Process each matching task
    respondents_processed = 0
    respondents_with_valid_data = 0
    
    for task_num in matching_tasks:
        task_columns = columns_by_task[task_num]
        logger.debug(f"[use_with_new_options_data] Processing task {task_num} with {len(task_columns)} columns")
        
        # Process each respondent
        for row in survey_data_rows:
            respondents_processed += 1
            # Get shares for this task from this respondent
            task_shares = {}
            total_share = 0.0
            
            for col_info in task_columns:
                col_name = col_info.get('columnName')
                product_name = col_info.get('productName')
                
                if not col_name or not product_name:
                    continue
                
                if col_name in row:
                    value_str = str(row.get(col_name, '')).strip()
                    if value_str and value_str.lower() not in ['', 'nan', 'none', 'null']:
                        try:
                            share_value = float(value_str)
                            # Handle both percentage (0-100) and decimal (0-1) formats
                            if 0 <= share_value <= 100:
                                if share_value > 1.0:
                                    share_value = share_value / 100.0  # Convert percentage to decimal
                                task_shares[product_name] = share_value
                                total_share += share_value
                                all_products_in_data.add(product_name)
                        except (ValueError, TypeError) as e:
                            logger.debug(f"[use_with_new_options_data] Invalid share value '{value_str}' for {product_name}: {e}")
                            pass
            
            # Normalize shares for this respondent (they might not sum to 1.0)
            if total_share > 0:
                respondents_with_valid_data += 1
                for product_name, share_value in task_shares.items():
                    normalized_share = share_value / total_share if total_share > 0 else 0
                    # Initialize if needed
                    if product_name not in product_shares:
                        product_shares[product_name] = []
                    product_shares[product_name].append(normalized_share)
    
    logger.info(f"[use_with_new_options_data] Processed {respondents_processed} respondents, {respondents_with_valid_data} with valid data")
    
    # Calculate average shares across all respondents
    if not any(product_shares.values()):
        logger.warning("[use_with_new_options_data] No valid share data found after processing")
        return None, []
    
    # Map to original product order
    projected_shares = []
    new_product_share = 0.0
    
    for product in original_products:
        product_name = product.get('name')
        shares_list = product_shares.get(product_name, [])
        if shares_list:
            avg_share = sum(shares_list) / len(shares_list)
            logger.debug(f"[use_with_new_options_data] Product {product_name}: {len(shares_list)} observations, avg share = {avg_share:.4f}")
        else:
            avg_share = 0.0
            logger.debug(f"[use_with_new_options_data] Product {product_name}: No data found")
        projected_shares.append(avg_share)
    
    # Find new product share
    # Check if there's a product that's not in original_products
    new_product_candidates = []
    for product_name, shares_list in product_shares.items():
        if product_name not in [p.get('name') for p in original_products]:
            if shares_list:
                new_product_candidates.append((product_name, shares_list))
    
    if new_product_candidates:
        # Use the product with the most observations or highest average share
        # Typically there should only be one, but handle multiple cases
        best_candidate = max(new_product_candidates, key=lambda x: (len(x[1]), sum(x[1]) / len(x[1])))
        new_product_share = sum(best_candidate[1]) / len(best_candidate[1])
        logger.info(f"[use_with_new_options_data] Found new product '{best_candidate[0]}' with share {new_product_share:.4f} from {len(best_candidate[1])} observations")
    
    # If we didn't find a separate new product, calculate from remainder
    if new_product_share == 0.0:
        total_existing = sum(projected_shares)
        if total_existing < 1.0:
            new_product_share = 1.0 - total_existing
            logger.debug(f"[use_with_new_options_data] Calculating new product share from remainder: {new_product_share:.4f}")
        # Normalize to ensure they sum to 1.0
        total_all = sum(projected_shares) + new_product_share
        if total_all > 0 and abs(total_all - 1.0) > 0.001:
            logger.debug(f"[use_with_new_options_data] Normalizing shares (total was {total_all:.4f})")
            projected_shares = [s / total_all for s in projected_shares]
            new_product_share = new_product_share / total_all
    
    projected_shares.append(new_product_share)
    
    # Verify shares sum to 1.0
    total_projected = sum(projected_shares)
    if abs(total_projected - 1.0) > 0.001:
        logger.warning(f"[use_with_new_options_data] Projected shares sum to {total_projected:.4f}, not 1.0. Normalizing.")
        projected_shares = [s / total_projected for s in projected_shares]
    
    logger.info(f"[use_with_new_options_data] Successfully calculated projected shares: {[f'{s:.4f}' for s in projected_shares]}")
    
    return projected_shares, matching_tasks

def calibrate_utilities_from_shares(observed_shares: List[float], tolerance: float = 1e-6, max_iterations: int = 100) -> List[float]:
    """
    Calibrate utilities from observed market shares using iterative adjustment.
    
    This finds utilities such that softmax(utilities) ≈ observed_shares.
    Uses the log-share transformation as initial guess, then iteratively adjusts.
    
    The key insight: we want to preserve the relative differences in shares
    when redistributing, so we use a more aggressive scaling that maintains
    the ratio structure rather than just matching absolute shares.
    
    Args:
        observed_shares: List of observed market shares (must sum to ~1.0)
        tolerance: Convergence tolerance
        max_iterations: Maximum iterations
        
    Returns:
        List of calibrated utilities
    """
    if len(observed_shares) == 0:
        return []
    
    # Normalize shares
    total = sum(observed_shares)
    if total == 0:
        return [0.0] * len(observed_shares)
    normalized_shares = [s / total for s in observed_shares]
    
    # Initial guess: log-share transformation with scaling factor
    # Use a scaling factor to amplify differences between products
    # This helps preserve preference structure when redistributing
    epsilon = 1e-10
    log_shares = [np.log(s + epsilon) for s in normalized_shares]
    
    # Calculate a scaling factor based on the range of shares
    # Products with more similar shares will have more similar utilities
    # Products with very different shares will have more different utilities
    min_share = min(s for s in normalized_shares if s > epsilon)
    max_share = max(normalized_shares)
    share_range = max_share - min_share if max_share > min_share else 1.0
    
    # Scale factor: larger when shares are similar (to preserve differences)
    # This ensures that small differences in market share translate to 
    # meaningful differences in utility that affect redistribution
    if share_range > 0.1:
        # Large range - use moderate scaling
        scale_factor = 2.0
    elif share_range > 0.05:
        # Medium range - use higher scaling
        scale_factor = 3.0
    else:
        # Small range - use aggressive scaling to preserve differences
        scale_factor = 4.0
    
    utilities = [ls * scale_factor for ls in log_shares]
    
    # Adjust utilities so they're centered (softmax is invariant to additive constant)
    utilities = np.array(utilities)
    utilities = utilities - np.mean(utilities)
    
    # Iterative refinement using Newton-like method
    for iteration in range(max_iterations):
        # Calculate predicted shares from current utilities
        predicted_shares = softmax(utilities)
        
        # Check convergence
        max_diff = max(abs(p - o) for p, o in zip(predicted_shares, normalized_shares))
        if max_diff < tolerance:
            break
        
        # Adjust utilities based on ratio of observed to predicted shares
        # Use a more aggressive adjustment for better convergence
        adjustments = []
        for pred, obs in zip(predicted_shares, normalized_shares):
            if pred > 1e-10 and obs > 1e-10:
                # Use log ratio with scaling to preserve structure
                ratio = obs / pred
                adjustments.append(np.log(ratio) * scale_factor * 0.5)
            else:
                adjustments.append(0.0)
        
        # Apply adjustments
        utilities = utilities + np.array(adjustments)
        
        # Re-center for stability
        utilities = utilities - np.mean(utilities)
    
    return utilities.tolist()

def project_market_shares_with_new_product(
    original_shares: List[Dict[str, Any]], 
    new_product_utility: float,
    existing_utilities: List[float],
    rule: str = "logit"
) -> List[float]:
    """
    Project market shares when a new product is introduced.
    
    Uses logit choice probabilities, but with utilities that have been
    calibrated and potentially adjusted to preserve preference structure.
    
    Args:
        original_shares: List of original product market shares (dicts with 'currentShare')
        new_product_utility: Utility of the new product
        existing_utilities: Utilities of existing products (calibrated from observed shares)
        rule: Choice rule ("logit" or "first_choice")
        
    Returns:
        Projected market shares including new product
    """
    # Combine existing utilities with new product utility
    all_utilities = existing_utilities + [new_product_utility]
    
    if rule == "logit":
        # Use softmax to calculate shares
        # This naturally redistributes based on utility differences
        # Products with utilities closer to the new product will lose more share
        shares = softmax(np.array(all_utilities)).tolist()
    elif rule == "first_choice":
        # Winner takes all
        shares = [1.0 if i == int(np.argmax(all_utilities)) else 0.0 for i in range(len(all_utilities))]
    else:
        raise ValueError(f"Unknown choice rule: {rule}")
    
    return shares

def scenario_utilities(scenarios: List[Dict[str, str]], utilities: Dict[str, Dict[str, float]], intercept: float) -> np.ndarray:
    """
    Calculate total utility for each scenario using estimated part-worths.

    For effects coding, reference levels have utility = -sum(other levels' utilities)

    Args:
        scenarios: List of scenarios with attribute-level pairs
        utilities: Estimated part-worth utilities by attribute and level
        intercept: Model intercept

    Returns:
        Array of total utilities for each scenario
    """
    u = []
    for s in scenarios:
        total = intercept
        for attr, lvl in s.items():
            u_map = utilities.get(attr, {})
            keys = [k for k in u_map.keys()]

            if lvl in keys:
                # Non-reference level: use estimated utility
                total += u_map[lvl]
            else:
                # Reference level: utility is negative sum of other levels
                total -= sum(u_map.get(k, 0.0) for k in keys)
        u.append(total)

    return np.array(u, dtype=float)

def softmax(x: np.ndarray) -> np.ndarray:
    """
    Compute softmax (multinomial logit choice probabilities).
    Uses numerical stability trick of subtracting max.

    Args:
        x: Array of utilities

    Returns:
        Array of choice probabilities (sums to 1.0)
    """
    m = np.max(x)
    ex = np.exp(x - m)
    return ex / np.sum(ex)

def match_scenario_to_survey_data(
    scenario: Dict[str, str],
    survey_data_rows: List[Dict[str, Any]],
    attribute_columns: List[str],
    schema: Optional[Dict[str, Any]] = None,
    return_best_candidate: bool = False,
    attribute_column_mapping: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """
    Match a scenario (attribute levels) to a task and product in survey data.
    
    Survey data rows contain hATTR_* columns that represent the experimental design.
    Each row represents one respondent's view of one task/product combination.
    
    Args:
        scenario: Dictionary mapping attribute names to level text
        survey_data_rows: List of survey data rows (each is a dict with hATTR_* columns)
        attribute_columns: List of attribute column names (hATTR_* pattern)
        schema: Schema containing attribute definitions with labels
        
    Returns:
        Dictionary with 'task', 'concept', 'rowNumber' if match found, None otherwise
    """
    if not survey_data_rows or not attribute_columns or len(attribute_columns) == 0:
        logger.warning("[match_scenario_to_survey_data] No survey data or attribute columns provided")
        return None
    
    # Log the type of survey_data_rows for debugging
    logger.info(f"[match_scenario_to_survey_data] survey_data_rows type: {type(survey_data_rows)}, length: {len(survey_data_rows) if survey_data_rows else 0}")
    if survey_data_rows and len(survey_data_rows) > 0:
        first_row_type = type(survey_data_rows[0])
        logger.info(f"[match_scenario_to_survey_data] First row type: {first_row_type}, is dict: {isinstance(survey_data_rows[0], dict)}, is str: {isinstance(survey_data_rows[0], str)}")
        if isinstance(survey_data_rows[0], str):
            logger.info(f"[match_scenario_to_survey_data] First row (string) preview: {str(survey_data_rows[0])[:200]}")
        elif isinstance(survey_data_rows[0], dict):
            logger.info(f"[match_scenario_to_survey_data] First row (dict) has {len(survey_data_rows[0])} keys")
    
    # Build attribute name to code mapping from schema
    attr_name_to_schema = {}
    if schema and "attributes" in schema:
        for idx, attr in enumerate(schema["attributes"]):
            attr_name = attr.get("name", "")
            if attr_name:
                attr_name_to_schema[attr_name] = attr
                # If attributeNo is missing, use 1-based index position as fallback
                if "attributeNo" not in attr and "attribute_number" not in attr:
                    attr["attributeNo"] = idx + 1
    
    # Log schema attributes for debugging
    if schema and "attributes" in schema:
        logger.info(f"[match_scenario_to_survey_data] Schema has {len(schema['attributes'])} attributes: {[attr.get('name', '') for attr in schema['attributes'][:5]]}...")
    else:
        logger.warning(f"[match_scenario_to_survey_data] No schema or attributes in schema")
    
    # Log scenario attributes for debugging
    logger.info(f"[match_scenario_to_survey_data] Scenario attributes: {list(scenario.keys())[:5]}...")
    
    # If we have a pre-computed attribute column mapping, use it for faster matching
    if attribute_column_mapping:
        logger.info(f"[match_scenario_to_survey_data] Using pre-computed attribute column mapping with {len(attribute_column_mapping)} task/concept/attribute combinations")
    
    # Find Task column (try various naming patterns)
    first_row = survey_data_rows[0] if survey_data_rows else {}
    
    # Log available columns for debugging
    sample_cols = list(first_row.keys())[:30]
    logger.info(f"[match_scenario_to_survey_data] Available columns (sample): {sample_cols}")
    
    task_col = None
    task_patterns = [
        r'^task$', 
        r'^task_number$', 
        r'^tasknum', 
        r'^t$',
        r'task',
        r'^qc1_',  # Choice columns like QC1_1 might indicate task
        r'^qs3r',  # Choice columns like QS3r1 might indicate task
        r'^qc_\d+r1',  # Choice columns like QC_1r1 might indicate task
    ]
    for col in first_row.keys():
        col_str = str(col).strip()
        for pattern in task_patterns:
            if re.search(pattern, col_str, re.IGNORECASE):
                task_col = col
                logger.info(f"[match_scenario_to_survey_data] Found Task column: '{task_col}' using pattern '{pattern}'")
                break
        if task_col:
            break
    
    # If still no Task column, try to infer from hATTR column names
    # hATTR columns often have task info embedded (e.g., hATTR_GORE_1c1 = task 1, concept 1)
    # Pattern: hATTR_GORE_1c1 means task 1, concept 1
    if not task_col:
        # Check if we can extract task from hATTR column names
        # Look for patterns like hATTR_*_1c1 (where 1 before 'c' is the task)
        logger.info(f"[match_scenario_to_survey_data] Checking hATTR column patterns. Sample columns: {attribute_columns[:10]}")
        for attr_col in attribute_columns[:20]:  # Check first 20 attribute columns
            attr_col_str = str(attr_col).strip()
            # Try to extract task number from column name patterns like hATTR_GORE_1c1
            # Pattern: hATTR_*_<task>c<concept>
            task_match = re.search(r'(\d+)c\d+', attr_col_str, re.IGNORECASE)
            if task_match:
                # Found pattern - can extract task/concept from hATTR column names
                task_col = 'task_from_hattr'  # Placeholder to indicate we'll extract from hATTR
                logger.info(f"[match_scenario_to_survey_data] Found hATTR column pattern in '{attr_col}' - will extract task/concept from hATTR column names")
                break
        
        # If still no task column, check for QC2 columns
        if not task_col:
            qc2_pattern = r'^qc2_(\d+)'
            for col in first_row.keys():
                col_str = str(col).strip()
                qc2_match = re.match(qc2_pattern, col_str, re.IGNORECASE)
                if qc2_match:
                    # QC2 columns have task numbers embedded (e.g., QC2_1r1c1 = task 1)
                    task_col = 'task_from_qc2'  # Placeholder to indicate we'll extract from QC2
                    logger.info(f"[match_scenario_to_survey_data] Found QC2 columns - will extract task from column names")
                    break
    
    # If we couldn't find a direct Task column or QC2/hATTR pattern, log and return
    if not task_col:
        # Log all column names to help debug
        all_cols = list(first_row.keys())
        logger.warning(f"[match_scenario_to_survey_data] No Task column found in survey data. All columns: {all_cols[:50]}")
        return None
    
    # Find Concept/Product column (try various naming patterns)
    concept_col = None
    concept_patterns = [
        r'^concept$', 
        r'^alt$', 
        r'^alternative$', 
        r'^product$', 
        r'^rownumber$', 
        r'^rownum',
        r'^row_number$',
        r'^r\d+$',  # Pattern like r1, r2, r3, r4, r5
    ]
    for col in first_row.keys():
        col_str = str(col).strip()
        for pattern in concept_patterns:
            if re.match(pattern, col_str, re.IGNORECASE):
                concept_col = col
                logger.info(f"[match_scenario_to_survey_data] Found Concept column: '{concept_col}' using pattern '{pattern}'")
                break
        if concept_col:
            break
    
    # If no concept column found, try to extract from QC2 or hATTR column names
    # QC2 columns like QC2_1r4c1 indicate task 1, row 4 (Product 4)
    # hATTR columns like hATTR_GORE_1c4 indicate task 1, concept 4
    if not concept_col:
        if task_col == 'task_from_hattr':
            # If we're using hATTR columns, concept is also embedded there
            concept_col = 'concept_from_hattr'  # Placeholder
            logger.info(f"[match_scenario_to_survey_data] Will extract concept from hATTR column names")
        else:
            qc2_pattern = r'^qc2_\d+r(\d+)'
            for col in first_row.keys():
                col_str = str(col).strip()
                qc2_match = re.match(qc2_pattern, col_str, re.IGNORECASE)
                if qc2_match:
                    # The row number (concept) is embedded in the column name
                    concept_col = 'concept_from_qc2'  # Placeholder
                    logger.info(f"[match_scenario_to_survey_data] Found QC2 columns - will extract concept from column names")
                    break
    
    logger.info(f"[match_scenario_to_survey_data] Using Task column: '{task_col}', Concept column: '{concept_col}', {len(attribute_columns)} attribute columns")
    
    # Group survey rows by task and concept to find matching product combinations
    # We'll look for rows that match the scenario's attribute levels
    best_match = None
    best_match_score = 0.0
    
    # Since survey data is in wide format (one row per respondent),
    # we can't group rows by task/concept directly.
    # Instead, we'll iterate through all possible task/concept combinations
    # by examining the hATTR column names, then check if the attribute values match
    
    # Extract unique task/concept combinations from hATTR column names
    task_concept_combinations = set()
    for attr_col in attribute_columns:
        attr_col_str = str(attr_col).strip()
        # Pattern: hATTR_GORE_1c4 means task 1, concept 4
        # Pattern: hATTR_PFO_2c5 means task 2, concept 5
        match = re.search(r'(\d+)c(\d+)', attr_col_str, re.IGNORECASE)
        if match:
            task_num = match.group(1)
            concept_num = match.group(2)
            task_concept_combinations.add((task_num, concept_num))
    
    logger.info(f"[match_scenario_to_survey_data] Found {len(task_concept_combinations)} unique task/concept combinations from hATTR columns")
    
    # If we couldn't extract from hATTR columns, try QC2 columns
    if len(task_concept_combinations) == 0:
        for col in first_row.keys():
            col_str = str(col).strip()
            # QC2_1r4c1 = task 1, row 4
            qc2_match = re.match(r'^qc2_(\d+)r(\d+)', col_str, re.IGNORECASE)
            if qc2_match:
                task_num = qc2_match.group(1)
                concept_num = qc2_match.group(2)
                task_concept_combinations.add((task_num, concept_num))
        
        if len(task_concept_combinations) > 0:
            logger.info(f"[match_scenario_to_survey_data] Found {len(task_concept_combinations)} task/concept combinations from QC2 columns")
    
    if len(task_concept_combinations) == 0:
        logger.warning("[match_scenario_to_survey_data] Could not extract task/concept combinations from column names")
        return None
    
    # For each unique task/concept combination, check if it matches the scenario
    # We'll use the first survey data row to check attribute values (since all rows have same column structure)
    # Handle case where survey_data_rows might contain strings (JSON) instead of dicts
    first_row_raw = survey_data_rows[0] if survey_data_rows else None
    sample_row = {}
    
    if first_row_raw:
        if isinstance(first_row_raw, dict):
            sample_row = first_row_raw
        elif isinstance(first_row_raw, str):
            # Try to parse as JSON
            try:
                import json
                sample_row = json.loads(first_row_raw)
                logger.info(f"[match_scenario_to_survey_data] Parsed first row from JSON string")
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"[match_scenario_to_survey_data] Failed to parse sample_row as JSON: {e}")
                sample_row = {}
        else:
            logger.warning(f"[match_scenario_to_survey_data] sample_row is not a dict or string. Type: {type(first_row_raw)}")
            sample_row = {}
    
    # Log sample row structure for debugging
    if sample_row and isinstance(sample_row, dict):
        sample_keys = list(sample_row.keys())[:10]
        logger.info(f"[match_scenario_to_survey_data] Sample row has {len(sample_row)} keys. Sample: {sample_keys}")
    
    # Log sample of task/concept combinations for debugging
    logger.info(f"[match_scenario_to_survey_data] Checking {len(task_concept_combinations)} task/concept combinations. Sample: {list(task_concept_combinations)[:5]}")
    logger.info(f"[match_scenario_to_survey_data] Scenario has {len(scenario)} attributes to match")
    
    # Track first task/concept for detailed logging
    first_task_concept_checked = True
    detailed_diagnostics = None  # Store detailed diagnostics from first checked task/concept
    
    # First, determine which concepts actually exist in the data
    # Check the actual concept column values if available, otherwise use all concepts found in hATTR columns
    actual_concepts = set()
    if concept_col and concept_col in first_row:
        # Try to get concept values from the actual concept column
        for row in survey_data_rows[:10]:  # Check first 10 rows
            if isinstance(row, dict):
                concept_val = row.get(concept_col)
                if concept_val:
                    actual_concepts.add(str(concept_val).strip())
    else:
        # Fallback: extract from hATTR column names
        for task_num, concept_num in task_concept_combinations:
            actual_concepts.add(concept_num)
    
    # If we still don't have concepts, use all concepts from task_concept_combinations
    if not actual_concepts:
        for task_num, concept_num in task_concept_combinations:
            actual_concepts.add(concept_num)
    
    logger.info(f"[match_scenario_to_survey_data] Detected concept values in data: {sorted(actual_concepts)}")
    
    # Collect all combinations for the actual concepts found in the data
    # Check design matrix for Concept column if available (from analyze_scenarios context)
    # Otherwise, check concept column in survey data, or use hATTR column patterns
    concept_col_values = set()
    
    # First, try to find actual Concept column in survey data
    actual_concept_col = None
    for col in first_row.keys():
        col_str = str(col).strip().lower()
        if col_str in ['concept', 'alt', 'alternative', 'product']:
            actual_concept_col = col
            break
    
    if actual_concept_col and actual_concept_col in first_row:
        for row in survey_data_rows[:20]:  # Check more rows to be sure
            if isinstance(row, dict):
                concept_val = row.get(actual_concept_col)
                if concept_val:
                    concept_col_values.add(str(concept_val).strip())
        logger.info(f"[match_scenario_to_survey_data] Found actual Concept column '{actual_concept_col}' with values: {sorted(concept_col_values)}")
    
    # Check ALL concepts to find the best match for the scenario
    # Don't filter to only concepts 4/5 - the scenario might match better to other concepts
    # The "new product" designation will come from comparing c2 data to original products
    target_concepts = sorted([int(c) for c in actual_concepts if c.isdigit()])
    target_concepts_str = [str(c) for c in target_concepts]
    
    logger.info(f"[match_scenario_to_survey_data] Checking ALL concepts to find best match: {target_concepts_str}")
    
    product_combinations = []
    for task_num, concept_num in task_concept_combinations:
        # Determine rowNumber (same as concept number)
        try:
            concept_int = int(concept_num)
            row_number = concept_int
        except:
            row_number = None
        
        # Check all concepts that exist in the data (no filtering)
        if concept_num not in target_concepts_str:
            continue
        
        # Count columns for this task/concept combination
        pattern = rf'(?<![\d])_{task_num}c{concept_num}(?!\d)'
        matching_cols = [col for col in attribute_columns if re.search(pattern, str(col), re.IGNORECASE)]
        product_combinations.append({
            'task': task_num,
            'concept': concept_num,
            'row_number': row_number,
            'column_count': len(matching_cols),
            'columns': matching_cols
        })
    
    # Sort by column count (descending) to prioritize more complete combinations
    product_combinations.sort(key=lambda x: x['column_count'], reverse=True)
    
    # Log the top combinations
    if product_combinations:
        concept_label = f"Product {target_concepts_str}" if len(target_concepts_str) <= 2 else "Product combinations"
        logger.info(f"[match_scenario_to_survey_data] Found {len(product_combinations)} {concept_label} combinations. Top 5 by column count:")
        for i, combo in enumerate(product_combinations[:5]):
            logger.info(f"  {i+1}. Task {combo['task']}, Concept {combo['concept']}: {combo['column_count']} columns")
    
    # NEW APPROACH: If we have pre-computed mapping, use it to match across ALL product combinations
    # instead of checking each combination independently
    if attribute_column_mapping and len(attribute_column_mapping) > 0:
        logger.info(f"[match_scenario_to_survey_data] Using pre-computed mapping to match across all combinations")
        
        # Extract all unique task/concept combinations from the mapping keys
        all_task_concept_combos = set()
        for mapping_key in attribute_column_mapping.keys():
            parts = mapping_key.split('_')
            if len(parts) >= 3:
                task_num = parts[0]
                concept_num = parts[1]
                all_task_concept_combos.add((task_num, concept_num))
        
        logger.info(f"[match_scenario_to_survey_data] Found {len(all_task_concept_combos)} unique task/concept combinations in mapping")
        # Log sample of combinations to verify
        sample_combos = list(all_task_concept_combos)[:10]
        logger.info(f"[match_scenario_to_survey_data] Sample task/concept combinations from mapping: {sample_combos}")
        
        # Score each task/concept combination by how many scenario attributes match it
        # This gives us a true match score for each combination
        task_concept_scores = {}  # (task, concept) -> {match_count, matched_attributes, unmatched_attributes}
        aggregate_total_attributes = 0
        aggregate_skipped_no_schema = 0
        
        # Use the first row for value extraction (handle case where it might be a string)
        first_row_raw = survey_data_rows[0] if survey_data_rows else None
        sample_row = {}
        
        if first_row_raw:
            if isinstance(first_row_raw, dict):
                sample_row = first_row_raw
            elif isinstance(first_row_raw, str):
                try:
                    import json
                    sample_row = json.loads(first_row_raw)
                    logger.info(f"[match_scenario_to_survey_data] Parsed sample_row from JSON string for aggregate matching")
                except (json.JSONDecodeError, Exception) as e:
                    logger.warning(f"[match_scenario_to_survey_data] Failed to parse sample_row as JSON: {e}")
                    sample_row = {}
        
        # Build attribute name to schema mapping
        attr_name_to_schema = {}
        if schema and "attributes" in schema:
            for attr in schema["attributes"]:
                attr_name = attr.get("name", "").upper().replace(" ", "_")
                attr_name_to_schema[attr_name] = attr
        
        # Also build a normalized mapping (handle variations in attribute name format)
        # Create a copy of items to iterate over to avoid "dictionary changed size during iteration" error
        normalized_entries = {}
        for attr_name, schema_attr in list(attr_name_to_schema.items()):
            # Add variations: with/without underscores, different case
            normalized_name = attr_name.replace("_", "").replace(" ", "")
            if normalized_name != attr_name:  # Only add if different
                normalized_entries[normalized_name] = schema_attr
        
        # Update the dictionary with normalized entries
        attr_name_to_schema.update(normalized_entries)
        
        # NEW APPROACH: For each task/concept combination, check how many scenario attributes match it
        # This gives us a proper match score for each combination
        logger.info(f"[match_scenario_to_survey_data] Evaluating {len(all_task_concept_combos)} task/concept combinations against {len(scenario)} scenario attributes")
        
        # Iterate through all scenario attributes first to build attribute data
        scenario_attributes_data = []
        for attr_name, level_text in scenario.items():
            aggregate_total_attributes += 1
            
            # Find the schema attribute (try exact match first, then normalized)
            schema_attr = attr_name_to_schema.get(attr_name.upper().replace(" ", "_"))
            if not schema_attr:
                normalized_name = attr_name.upper().replace("_", "").replace(" ", "")
                schema_attr = attr_name_to_schema.get(normalized_name)
            
            if not schema_attr:
                aggregate_skipped_no_schema += 1
                logger.debug(f"[match_scenario_to_survey_data] No schema found for attribute: {attr_name}")
                continue
            
            # Get attribute number
            attr_no = schema_attr.get("attributeNo") or schema_attr.get("attribute_number")
            if not attr_no and schema and "attributes" in schema:
                try:
                    attr_index = schema["attributes"].index(schema_attr)
                    attr_no = attr_index + 1
                except (ValueError, AttributeError):
                    pass
            
            if not attr_no:
                aggregate_skipped_no_schema += 1
                logger.debug(f"[match_scenario_to_survey_data] No attribute number for: {attr_name}")
                continue
            
            attr_no_str = str(attr_no).strip()
            
            # Get schema levels for this attribute to extract level code/text
            schema_levels = schema_attr.get("levels", [])
            if not schema_levels:
                aggregate_skipped_no_schema += 1
                continue
            
            # Extract the level code from scenario value (level_text might be level text or code)
            scenario_level_code = None
            scenario_level_text = str(level_text).strip()
            
            # Try to find matching level in schema by text
            # Schema levels can be strings (like "90% On-table closure rate...") or dicts with code/text
            # We need to find which level index matches the scenario text, then construct the code
            scenario_level_index = None
            scenario_level_code = None
            
            for idx, level in enumerate(schema_levels):
                if isinstance(level, dict):
                    level_code = str(level.get("code", "")).strip()
                    level_text_from_schema = str(level.get("levelText", "")).strip() or str(level.get("level", "")).strip()
                    
                    # Check if scenario value matches this level (by code or text)
                    if level_code and level_code == scenario_level_text:
                        scenario_level_code = level_code
                        scenario_level_index = idx
                        break
                    if level_text_from_schema and level_text_from_schema.lower() == scenario_level_text.lower():
                        scenario_level_code = level_code if level_code else None
                        scenario_level_index = idx
                        break
                else:
                    # Level is just a string
                    level_text_str = str(level).strip()
                    if level_text_str.lower() == scenario_level_text.lower():
                        # Found matching level text - construct code from attribute number and level index
                        # Attribute codes are typically: attr_no * 10 + (level_index + 1)
                        # e.g., attr 1, level 0 (first level) = 11, level 1 (second level) = 12, etc.
                        try:
                            attr_no_int = int(attr_no_str)
                            level_no = idx + 1  # Level numbers start at 1
                            scenario_level_code = str(attr_no_int * 10 + level_no)
                            scenario_level_index = idx
                            break
                        except (ValueError, TypeError):
                            scenario_level_index = idx
                            break
            
            # If no level code found but we have an index, construct it
            if scenario_level_index is not None and not scenario_level_code:
                try:
                    attr_no_int = int(attr_no_str)
                    level_no = scenario_level_index + 1
                    scenario_level_code = str(attr_no_int * 10 + level_no)
                except (ValueError, TypeError):
                    pass
            
            # If still no level code found, use scenario value as-is (might be a code)
            if not scenario_level_code:
                scenario_level_code = scenario_level_text
            
            # Store this attribute data for later evaluation against each task/concept
            scenario_attributes_data.append({
                'attr_name': attr_name,
                'attr_no_str': attr_no_str,
                'level_text': scenario_level_text,
                'level_code': scenario_level_code,
                'schema_levels': schema_levels
            })
        
        # NOW: For each task/concept combination, check how many scenario attributes match it
        # This is the correct approach - evaluate each combination against all attributes
        logger.info(f"[match_scenario_to_survey_data] Now evaluating each task/concept combination for complete scenario matches...")
        
        rows_to_check = survey_data_rows if survey_data_rows else []
        
        # For each task/concept combination, check all scenario attributes
        for (task_num, concept_num) in all_task_concept_combos:
            key = (task_num, concept_num)
            
            # Initialize score for this combination
            task_concept_scores[key] = {
                'match_count': 0,
                'matched_attributes': [],
                'unmatched_attributes': []
            }
            
            # Check each scenario attribute against this specific task/concept
            for attr_data in scenario_attributes_data:
                attr_no_str = attr_data['attr_no_str']
                attr_name = attr_data['attr_name']
                scenario_level_text = attr_data['level_text']
                scenario_level_code = attr_data['level_code']
                schema_levels = attr_data['schema_levels']
                
                # Build the mapping key for this task/concept/attribute
                mapping_key = f"{task_num}_{concept_num}_{attr_no_str}"
                
                # Check if this mapping exists
                if mapping_key not in attribute_column_mapping:
                    task_concept_scores[key]['unmatched_attributes'].append({
                        'attr_no': attr_no_str,
                        'attr_name': attr_name,
                        'scenario_value': scenario_level_text,
                        'reason': 'no_mapping'
                    })
                    continue
                
                column_mappings_list = attribute_column_mapping[mapping_key]
                
                # Find the column for this attribute in this task/concept
                attr_col = None
                for mapping_entry in column_mappings_list:
                    if isinstance(mapping_entry, dict):
                        mapping_attr_no = str(mapping_entry.get('attributeNumber', '')).strip()
                        if mapping_attr_no == attr_no_str:
                            attr_col = mapping_entry.get('valueColumn')
                            break
                    elif isinstance(mapping_entry, str):
                        attr_col = mapping_entry
                        break
                
                if not attr_col:
                    task_concept_scores[key]['unmatched_attributes'].append({
                        'attr_no': attr_no_str,
                        'attr_name': attr_name,
                        'scenario_value': scenario_level_text,
                        'reason': 'no_column'
                    })
                    continue
                
                # Check if any row has a matching value for this column
                matched = False
                row_value_str = None
                for check_row in rows_to_check:
                    row_dict = check_row
                    if isinstance(check_row, str):
                        try:
                            import json
                            row_dict = json.loads(check_row)
                        except:
                            continue
                    
                    if not isinstance(row_dict, dict) or attr_col not in row_dict:
                        continue
                    
                    row_value = row_dict.get(attr_col)
                    row_value_str = str(row_value).strip() if row_value else ""
                    
                    if not row_value_str:
                        continue
                    
                    # Check if value matches (direct code match)
                    if scenario_level_code and scenario_level_code == row_value_str:
                        matched = True
                        break
                    
                    # Also check constructed codes
                    if not matched:
                        for idx, level in enumerate(schema_levels):
                            level_text_str = str(level).strip() if isinstance(level, str) else (str(level.get("levelText", "")) or str(level.get("level", ""))).strip()
                            try:
                                attr_no_int = int(attr_no_str)
                                level_no = idx + 1
                                constructed_code = str(attr_no_int * 10 + level_no)
                                if constructed_code == row_value_str and scenario_level_text.lower() == level_text_str.lower():
                                    matched = True
                                    scenario_level_code = constructed_code
                                    break
                            except:
                                continue
                    
                    if matched:
                        break
                
                if matched:
                    task_concept_scores[key]['match_count'] += 1
                    task_concept_scores[key]['matched_attributes'].append({
                        'attr_no': attr_no_str,
                        'attr_name': attr_name,
                        'row_value': row_value_str,
                        'scenario_code': scenario_level_code
                    })
                else:
                    task_concept_scores[key]['unmatched_attributes'].append({
                        'attr_no': attr_no_str,
                        'attr_name': attr_name,
                        'scenario_value': scenario_level_text,
                        'reason': 'no_match'
                    })
        
        # Build aggregate lists for backward compatibility and logging
        aggregate_matched_attributes_log = []
        aggregate_unmatched_attributes_log = []
        aggregate_match_count = 0
        aggregate_skipped_no_column = 0
        aggregate_skipped_no_value = 0
        
        # Build aggregate lists from task_concept_scores
        if task_concept_scores:
            for (task, concept), score_data in task_concept_scores.items():
                for attr_match in score_data['matched_attributes']:
                    aggregate_matched_attributes_log.append(
                        f"Attr {attr_match['attr_no']}: matched in Task {task}, Concept {concept} "
                        f"(row_value={attr_match['row_value']}, scenario={attr_match['scenario_code']})"
                    )
                    aggregate_match_count += 1
        
        # Calculate match scores for each task/concept combination
        if aggregate_total_attributes > 0 and task_concept_scores:
            # Calculate match score for each task/concept
            best_combo = None
            best_score = 0
            best_match_count = 0
            
            for (task, concept), score_data in task_concept_scores.items():
                match_count = score_data['match_count']
                match_score = match_count / aggregate_total_attributes
                
                # Update best if this is better
                if match_score > best_score or (match_score == best_score and match_count > best_match_count):
                    best_score = match_score
                    best_match_count = match_count
                    best_combo = (task, concept)
            
            # Log scores for top candidates
            sorted_scores = sorted(
                task_concept_scores.items(),
                key=lambda x: (x[1]['match_count'] / aggregate_total_attributes, x[1]['match_count']),
                reverse=True
            )
            top_5_scores = {f"Task {k[0]}, Concept {k[1]}": f"{v['match_count']}/{aggregate_total_attributes} ({v['match_count']/aggregate_total_attributes:.1%})" for k, v in sorted_scores[:5]}
            logger.info(f"[match_scenario_to_survey_data] Task/concept match scores: {top_5_scores}")
            
            aggregate_match_score = best_score if best_combo else 0
            aggregate_match_count = best_match_count if best_combo else 0
            
            logger.info(f"[match_scenario_to_survey_data] Best match: Task {best_combo[0]}, Concept {best_combo[1]} with {best_match_count}/{aggregate_total_attributes} attributes matched (score: {best_score:.2f})")
            
            # Return if match score is above threshold, or if return_best_candidate is True
            if aggregate_match_score >= 0.8 or return_best_candidate:
                if best_combo:
                    logger.info(f"[match_scenario_to_survey_data] Selected Task {best_combo[0]}, Concept {best_combo[1]} (matched {best_match_count} attributes: {[a['attr_no'] for a in task_concept_scores[best_combo]['matched_attributes'][:10]]})")
                else:
                    # Fallback: use first task/concept combo
                    best_combo = list(all_task_concept_combos)[0] if all_task_concept_combos else None
                
                if best_combo:
                    # Find the row number for this task/concept
                    row_number = None
                    for combo in product_combinations:
                        if str(combo['task']) == best_combo[0] and str(combo['concept']) == best_combo[1]:
                            row_number = combo.get('row_number')
                            break
                    
                    # If row_number not found, try to derive it from concept number
                    if row_number is None:
                        # Concept number might be the row number, or we might need to look it up differently
                        # Try using concept as row number (common pattern)
                        try:
                            concept_num = int(best_combo[1])
                            row_number = concept_num
                            logger.info(f"[match_scenario_to_survey_data] Using concept number {concept_num} as rowNumber")
                        except (ValueError, TypeError):
                            pass
                    
                    result = {
                        "task": int(best_combo[0]) if best_combo[0].isdigit() else None,
                        "concept": best_combo[1],
                        "rowNumber": row_number,
                        "matchScore": aggregate_match_score,
                        "detailed_diagnostics": {
                            "aggregate_match": True,
                            "total_attributes": aggregate_total_attributes,
                            "matched_attributes": aggregate_match_count,
                            "match_score": aggregate_match_score,
                            "matched_attributes_log": aggregate_matched_attributes_log[:10],
                            "unmatched_attributes": aggregate_unmatched_attributes_log[:10],
                            "skipped_breakdown": {
                                "no_schema": aggregate_skipped_no_schema,
                                "no_column": aggregate_skipped_no_column,
                                "no_value": aggregate_skipped_no_value
                            }
                        }
                    }
                    
                    if aggregate_match_score < 0.8:
                        result["belowThreshold"] = True
                    
                    logger.info(f"[match_scenario_to_survey_data] Returning match result: task={result['task']}, concept={result['concept']}, rowNumber={result['rowNumber']}, score={result['matchScore']}")
                    return result
    
    # FALLBACK: Original approach - check each combination independently
    # Now iterate through sorted combinations (most columns first)
    for combo in product_combinations:
        task_num = combo['task']
        concept_num = combo['concept']
        row_number = combo['row_number']
        
        # Log first task/concept being checked in detail
        is_first_check = first_task_concept_checked
        if first_task_concept_checked:
            logger.info(f"[match_scenario_to_survey_data] Checking Task {task_num}, Concept {concept_num} (Product {row_number}) in detail...")
            first_task_concept_checked = False
        
        # Match scenario attributes to hATTR columns in this row
        match_count = 0
        total_attributes = 0
        matched_attributes_log = []  # For debugging
        unmatched_attributes_log = []  # Track unmatched for debugging
        skipped_no_schema = 0
        skipped_no_column = 0
        skipped_no_value = 0
        
        # Log columns for this task/concept combination (using same pattern as matching logic)
        if is_first_check:
            pattern = rf'(?<![\d])_{task_num}c{concept_num}(?!\d)'
            task_concept_cols = [col for col in attribute_columns if re.search(pattern, str(col), re.IGNORECASE)]
            if task_concept_cols:
                logger.info(f"[match_scenario_to_survey_data] Task {task_num}, Concept {concept_num}: Found {len(task_concept_cols)} columns. Sample: {sorted(task_concept_cols)[:10]}")
                # Log all columns if there aren't too many
                if len(task_concept_cols) <= 30:
                    logger.info(f"[match_scenario_to_survey_data] All columns for Task {task_num}, Concept {concept_num}: {sorted(task_concept_cols)}")
            else:
                logger.warning(f"[match_scenario_to_survey_data] Task {task_num}, Concept {concept_num}: No columns found with pattern '{pattern}'")
                # Log some sample column names to help debug
                sample_cols = [str(col) for col in attribute_columns[:20]]
                logger.info(f"[match_scenario_to_survey_data] Sample attribute columns: {sample_cols}")
                # Try to find columns that contain the task/concept numbers
                contains_task = [col for col in attribute_columns if str(task_num) in str(col) and str(concept_num) in str(col)]
                if contains_task:
                    logger.info(f"[match_scenario_to_survey_data] Columns containing '{task_num}' and '{concept_num}': {sorted(contains_task)[:10]}")
        
        attr_idx = 0  # Track attribute index for logging
        for attr_name, level_text in scenario.items():
            total_attributes += 1
            attr_idx += 1
            
            # Find the schema attribute for this scenario attribute
            schema_attr = attr_name_to_schema.get(attr_name)
            if not schema_attr:
                # Try to find by label match
                for schema_name, schema_attr_candidate in attr_name_to_schema.items():
                    if schema_attr_candidate.get("label", "").lower() == attr_name.lower():
                        schema_attr = schema_attr_candidate
                        break
            
            if not schema_attr:
                skipped_no_schema += 1
                if is_first_check and skipped_no_schema <= 3:
                    logger.warning(f"[match_scenario_to_survey_data] No schema attribute found for '{attr_name}'. Available: {list(attr_name_to_schema.keys())[:5]}...")
                continue
            
            # Find the attribute column in survey data for this task/concept combination
            # Map schema attribute number to hATTR column
            # Try attributeNo, attribute_number, or use position in schema as fallback
            attr_no = schema_attr.get("attributeNo") or schema_attr.get("attribute_number")
            
            # If still no attribute number, use position in schema attributes list
            if not attr_no and schema and "attributes" in schema:
                try:
                    attr_index = schema["attributes"].index(schema_attr)
                    attr_no = attr_index + 1  # 1-based index
                except (ValueError, AttributeError):
                    pass
            
            attr_col = None
            attr_no_str = None  # Initialize to avoid undefined variable error
            
            # Try to use pre-computed mapping if available
            if attribute_column_mapping and attr_no:
                attr_no_str = str(attr_no).strip()
                mapping_key = f"{task_num}_{concept_num}_{attr_no_str}"
                
                # Log mapping lookup for debugging (first few attributes only)
                if is_first_check and attr_idx < 5:
                    sample_keys = list(attribute_column_mapping.keys())[:5]
                    logger.info(f"[match_scenario_to_survey_data] Looking up mapping key '{mapping_key}' in pre-computed mapping. Sample keys: {sample_keys}")
                
                if mapping_key in attribute_column_mapping:
                    # Found pre-computed mapping! Use it directly
                    column_mappings = attribute_column_mapping[mapping_key]
                    if column_mappings and isinstance(column_mappings, list) and len(column_mappings) > 0:
                        # Use the first mapping (or could choose based on brand)
                        mapping = column_mappings[0]
                        if isinstance(mapping, dict):
                            attr_col = mapping.get('valueColumn')
                            if attr_col:
                                logger.info(f"[match_scenario_to_survey_data] ✓ Using pre-computed mapping for attribute {attr_no_str}: {attr_col}")
                        elif isinstance(mapping, str):
                            attr_col = mapping
                            logger.info(f"[match_scenario_to_survey_data] ✓ Using pre-computed mapping (string) for attribute {attr_no_str}: {attr_col}")
                    elif isinstance(column_mappings, str):
                        attr_col = column_mappings
                        logger.info(f"[match_scenario_to_survey_data] ✓ Using pre-computed mapping (direct string) for attribute {attr_no_str}: {attr_col}")
                elif is_first_check and attr_idx < 3:
                    logger.info(f"[match_scenario_to_survey_data] No pre-computed mapping found for key '{mapping_key}' (Task {task_num}, Concept {concept_num}, Attribute {attr_no_str})")
            
            # If we didn't find a column via pre-computed mapping, use the normal matching logic
            if not attr_col and attr_no:
                attr_no_str = str(attr_no).strip()
                # Find hATTR column that matches: task_num, concept_num, and attribute number
                # Pattern: hATTR_<BRAND>_<TASK>c<CONCEPT>
                # The attribute number is determined by POSITION in the sorted list of columns
                # for the same task/concept combination
                
                # First, find all columns matching task/concept pattern
                # Use negative lookbehind/lookahead to ensure we match exactly (e.g., "5c4" not "15c4" or "5c45")
                matching_cols = []
                for attr_col_name in attribute_columns:
                    attr_col_str = str(attr_col_name).strip()
                    # Pattern: Match _5c4 but not _15c4 or _5c45
                    # Use negative lookbehind to ensure task_num is not preceded by a digit
                    # Use negative lookahead to ensure concept_num is not followed by a digit
                    # Also handle end of string case
                    pattern = rf'(?<![\d])_{task_num}c{concept_num}(?!\d)'
                    task_concept_match = re.search(pattern, attr_col_str, re.IGNORECASE)
                    if task_concept_match:
                        matching_cols.append(attr_col_name)
                
                if matching_cols:
                    # Sort matching columns to ensure consistent ordering
                    # This groups columns by brand (GORE, PFO, GORE_H, PFO_H) and concept
                    matching_cols_sorted = sorted(matching_cols)
                    
                    # Group columns by brand prefix (hATTR_GORE, hATTR_PFO, etc.)
                    # We'll use the first brand's columns as the reference
                    brand_groups = {}
                    for col_name in matching_cols_sorted:
                        col_str = str(col_name).strip()
                        # Extract brand prefix (e.g., "GORE" from "hATTR_GORE_1c4" or "hATTR_GORE_9c5")
                        # Pattern should match: hATTR_<BRAND>_<TASK>c<CONCEPT>
                        brand_match = re.match(r'^hATTR_([A-Z0-9_]+?)_\d+c\d+', col_str, re.IGNORECASE)
                        if brand_match:
                            brand = brand_match.group(1)
                            if brand not in brand_groups:
                                brand_groups[brand] = []
                            brand_groups[brand].append(col_name)
                    
                    # Log brand groups for debugging
                    if is_first_check and brand_groups:
                        for brand, cols in brand_groups.items():
                            logger.info(f"[match_scenario_to_survey_data] Brand '{brand}' has {len(cols)} columns for Task {task_num}, Concept {concept_num}. Sample: {sorted(cols)[:5]}")
                    
                    # Strategy 1: Use HEADER columns to find which VALUE column contains this attribute
                    # Header columns (_H) contain attribute numbers, value columns contain level codes
                    # Match by finding the header column that contains our attribute number, then use the corresponding value column
                    attr_col_from_header = None
                    if attr_no_str and isinstance(sample_row, dict):
                        # Find header columns (contain _H_ or end with _H)
                        header_cols = [col for col in matching_cols_sorted if '_H_' in str(col) or str(col).endswith('_H')]
                        # Find value columns (no _H)
                        value_cols = [col for col in matching_cols_sorted if '_H_' not in str(col) and not str(col).endswith('_H')]
                        
                        # Build a map of header columns to their attribute numbers
                        header_to_attr = {}
                        for header_col in header_cols:
                            if header_col in sample_row:
                                header_value = str(sample_row[header_col]).strip()
                                header_to_attr[header_col] = header_value
                        
                        # Log header-to-attr mapping for debugging
                        if is_first_check and total_attributes <= 3:
                            logger.info(f"[match_scenario_to_survey_data] Header-to-attribute mapping for Task {task_num}, Concept {concept_num}: {header_to_attr}")
                            logger.info(f"[match_scenario_to_survey_data] Looking for attribute number: '{attr_no_str}' (type: {type(attr_no_str)})")
                        
                        # Check each header column to see if it contains our attribute number
                        for header_col, header_attr_no in header_to_attr.items():
                            if is_first_check and total_attributes <= 3:
                                logger.info(f"[match_scenario_to_survey_data] Checking header '{header_col}' with attr_no '{header_attr_no}' against target '{attr_no_str}'")
                            # Check if header value matches our attribute number (exact match or variations)
                            if (header_attr_no == attr_no_str or 
                                header_attr_no == f"0{attr_no_str}" or 
                                header_attr_no == f"ATT{attr_no_str}" or
                                header_attr_no == attr_no_str.zfill(2)):
                                
                                # Find the corresponding value column (same brand, task, concept, but without _H)
                                # Extract brand, task, concept from header column
                                header_match = re.match(r'^hATTR_([A-Z0-9_]+?)_H?_(\d+)c(\d+)', str(header_col), re.IGNORECASE)
                                if header_match:
                                    header_brand = header_match.group(1).replace('_H', '')
                                    header_task = header_match.group(2)
                                    header_concept = header_match.group(3)
                                    
                                    # Find matching value column with same brand/task/concept
                                    for value_col in value_cols:
                                        value_match = re.match(r'^hATTR_([A-Z0-9_]+?)_(\d+)c(\d+)', str(value_col), re.IGNORECASE)
                                        if value_match:
                                            value_brand = value_match.group(1).replace('_H', '')
                                            value_task = value_match.group(2)
                                            value_concept = value_match.group(3)
                                            
                                            # Match if brand, task, and concept are the same
                                            if (header_brand == value_brand and 
                                                header_task == value_task and 
                                                header_concept == value_concept):
                                                attr_col_from_header = value_col
                                                if is_first_check and total_attributes <= 3:
                                                    logger.info(f"[match_scenario_to_survey_data] Found attribute {attr_no_str} via header column '{header_col}' (attr={header_attr_no}) -> value column '{value_col}'")
                                                break
                                
                                if attr_col_from_header:
                                    break
                        
                        # Alternative: Try to match by position if header columns are ordered
                        if not attr_col_from_header and header_cols and value_cols:
                            # Sort header cols to match value cols order
                            sorted_header_cols = sorted(header_cols)
                            sorted_value_cols = sorted(value_cols)
                            
                            # Try to find value column by matching header position to value position
                            if len(sorted_header_cols) == len(sorted_value_cols):
                                for i, header_col in enumerate(sorted_header_cols):
                                    if header_col in header_to_attr and header_to_attr[header_col] == attr_no_str:
                                        if i < len(sorted_value_cols):
                                            attr_col_from_header = sorted_value_cols[i]
                                            if is_first_check and total_attributes <= 3:
                                                logger.info(f"[match_scenario_to_survey_data] Found attribute {attr_no_str} by header position {i} -> value column '{attr_col_from_header}'")
                                            break
                    
                    if attr_col_from_header:
                        attr_col = attr_col_from_header
                    
                    # Strategy 2: Try to find column with attribute number suffix (e.g., hATTR_GORE_11c4_1)
                    # Pattern: hATTR_<BRAND>_<TASK>c<CONCEPT>_<ATTR_NUM>
                    attr_col_with_suffix = None
                    if not attr_col and attr_no_str:
                        for col_name in matching_cols_sorted:
                            col_str = str(col_name).strip()
                            # Check for attribute number suffix patterns: _1, _01, _ATT1, etc.
                            suffix_patterns = [
                                rf'_{attr_no_str}(?!\d)',  # _1 (not _10, _11, etc.)
                                rf'_0{attr_no_str}(?!\d)',  # _01
                                rf'_ATT{attr_no_str}(?!\d)',  # _ATT1
                                rf'_{attr_no_str}$',  # _1 at end of string
                            ]
                            for suffix_pattern in suffix_patterns:
                                if re.search(suffix_pattern, col_str, re.IGNORECASE):
                                    attr_col_with_suffix = col_name
                                    if is_first_check and total_attributes <= 3:
                                        logger.info(f"[match_scenario_to_survey_data] Found attribute {attr_no_str} column by suffix: {col_name}")
                                    break
                            if attr_col_with_suffix:
                                break
                    
                    if attr_col_with_suffix:
                        attr_col = attr_col_with_suffix
                    
                    # Strategy 2: If no suffix match, try to find the largest brand group (most complete)
                    # and match by position
                    if not attr_col and brand_groups:
                        # Find the brand group with the most columns (likely the most complete)
                        brand_with_most_cols = max(brand_groups.items(), key=lambda x: len(x[1]))
                        largest_brand = brand_with_most_cols[0]
                        brand_cols = sorted(brand_with_most_cols[1])
                        
                        # Log if we don't have enough columns
                        if is_first_check and len(brand_cols) < 20:
                            logger.warning(f"[match_scenario_to_survey_data] Brand '{largest_brand}' only has {len(brand_cols)} columns, expected ~20 attributes. All columns: {brand_cols}")
                            # Check if there are more columns with different patterns
                            all_task_concept_cols = [col for col in attribute_columns if str(task_num) in str(col) and str(concept_num) in str(col)]
                            logger.info(f"[match_scenario_to_survey_data] Total columns containing '{task_num}' and '{concept_num}': {len(all_task_concept_cols)}. All: {sorted(all_task_concept_cols)}")
                            # Check for columns with attribute suffixes
                            attr_suffix_cols = [col for col in all_task_concept_cols if re.search(r'_\d+$|_ATT\d+', str(col), re.IGNORECASE)]
                            if attr_suffix_cols:
                                logger.info(f"[match_scenario_to_survey_data] Found {len(attr_suffix_cols)} columns with attribute suffixes. Sample: {attr_suffix_cols[:10]}")
                            
                            # IMPORTANT: Check header columns (_H) to understand which attributes are in each column
                            # Header columns contain attribute numbers, value columns contain level codes
                            if brand_cols and isinstance(sample_row, dict):
                                # Find corresponding header columns
                                header_cols = [col for col in matching_cols_sorted if '_H_' in str(col) or str(col).endswith('_H')]
                                logger.info(f"[match_scenario_to_survey_data] Found {len(header_cols)} header columns for Task {task_num}, Concept {concept_num}: {header_cols}")
                                
                                # Check header column values to see which attributes are present
                                for header_col in header_cols[:5]:  # Check first 5 header columns
                                    if header_col in sample_row:
                                        header_value = sample_row[header_col]
                                        logger.info(f"[match_scenario_to_survey_data] Header column '{header_col}' contains attribute number: {header_value}")
                                
                                # Also check first value column
                                if brand_cols[0] in sample_row:
                                    first_col_value = sample_row[brand_cols[0]]
                                    logger.info(f"[match_scenario_to_survey_data] Sample value from first column '{brand_cols[0]}': {str(first_col_value)[:500]}")
                                    logger.info(f"[match_scenario_to_survey_data] First column value type: {type(first_col_value)}, length: {len(str(first_col_value)) if first_col_value else 0}")
                        
                        # Match attribute by position in the sorted list
                        try:
                            attr_index = int(attr_no_str) - 1  # Convert to 0-based index
                            if 0 <= attr_index < len(brand_cols):
                                attr_col = brand_cols[attr_index]
                                if is_first_check and total_attributes <= 3:
                                logger.info(f"[match_scenario_to_survey_data] Matched attribute {attr_no_str} (index {attr_index}) to column {attr_col} for task {task_num}, concept {concept_num}")
                            else:
                                if is_first_check and total_attributes <= 3:
                                logger.warning(f"[match_scenario_to_survey_data] Attribute index {attr_index} out of range for {len(brand_cols)} columns (task {task_num}, concept {concept_num})")
                        except (ValueError, IndexError) as e:
                            if is_first_check and total_attributes <= 3:
                            logger.warning(f"[match_scenario_to_survey_data] Error matching attribute {attr_no_str} by position: {e}")
                            pass
                    
                    # Fallback: if no brand groups found, try direct position matching
                    if not attr_col and matching_cols_sorted:
                        try:
                            attr_index = int(attr_no_str) - 1
                            if 0 <= attr_index < len(matching_cols_sorted):
                                attr_col = matching_cols_sorted[attr_index]
                                logger.info(f"[match_scenario_to_survey_data] Fallback: Matched attribute {attr_no_str} to column {attr_col} by position")
                        except (ValueError, IndexError):
                            pass
                    
                    # Final fallback: use first column if only one match
                    if not attr_col and len(matching_cols_sorted) == 1:
                        attr_col = matching_cols_sorted[0]
            
            if not attr_col:
                skipped_no_column += 1
                # Log first few column lookup failures
                if is_first_check and total_attributes <= 3:
                    attr_no_display = attr_no_str if attr_no_str else "N/A"
                    logger.warning(f"[match_scenario_to_survey_data] No attribute column found for attr {attr_no_display} '{attr_name}' (Task {task_num}, Concept {concept_num})")
                continue
            
            # Get the level code from the survey data row
            # Use the first row as a sample (all rows should have same structure for this task/concept)
            row_level_code = ''
            
            # Ensure sample_row is a dict (defensive programming)
            current_sample_row = sample_row
            if not isinstance(current_sample_row, dict):
                logger.error(f"[match_scenario_to_survey_data] sample_row is not a dict before accessing column {attr_col}. Type: {type(current_sample_row)}")
                # Try to re-fetch and parse from survey_data_rows
                if survey_data_rows and len(survey_data_rows) > 0:
                    first_row_raw = survey_data_rows[0]
                    if isinstance(first_row_raw, dict):
                        current_sample_row = first_row_raw
                    elif isinstance(first_row_raw, str):
                        try:
                            import json
                            current_sample_row = json.loads(first_row_raw)
                            logger.info(f"[match_scenario_to_survey_data] Re-parsed sample_row from string")
                        except Exception as e:
                            logger.error(f"[match_scenario_to_survey_data] Failed to re-parse: {e}")
                            current_sample_row = {}
                    else:
                        current_sample_row = {}
                else:
                    current_sample_row = {}
            
            # Now safely access the column value
            try:
                # Log detailed info before accessing
                if is_first_check and total_attributes <= 3:
                    logger.info(f"[match_scenario_to_survey_data] About to access column {attr_col}. current_sample_row type: {type(current_sample_row)}, is dict: {isinstance(current_sample_row, dict)}, has get: {hasattr(current_sample_row, 'get') if current_sample_row else False}")
                
                if isinstance(current_sample_row, dict):
                    # Check if attr_col exists in the dict
                    if attr_col in current_sample_row:
                        # Get the value
                        raw_value = current_sample_row[attr_col]
                        # Log column value structure for first few attributes to understand format
                        if is_first_check and total_attributes <= 3:
                            value_preview = str(raw_value)[:200] if raw_value else "None"
                            logger.info(f"[match_scenario_to_survey_data] Column {attr_col} value preview: {value_preview}...")
                            logger.info(f"[match_scenario_to_survey_data] Column {attr_col} value type: {type(raw_value)}, length: {len(str(raw_value)) if raw_value else 0}")
                        # Check if the value itself is a string (which is fine)
                        row_level_code = str(raw_value).strip()
                    else:
                        # Column doesn't exist in this row
                        row_level_code = ''
                        if is_first_check and total_attributes <= 3:
                            logger.warning(f"[match_scenario_to_survey_data] Column {attr_col} not found in sample_row. Sample keys: {list(current_sample_row.keys())[:10]}")
                else:
                    logger.error(f"[match_scenario_to_survey_data] Cannot access row value - current_sample_row is not a dict. Type: {type(current_sample_row)}, value: {str(current_sample_row)[:100]}")
                    row_level_code = ''
            except (AttributeError, KeyError, TypeError) as e:
                import traceback
                logger.error(f"[match_scenario_to_survey_data] Error accessing row value for column {attr_col}: {e}")
                logger.error(f"[match_scenario_to_survey_data] Traceback: {traceback.format_exc()}")
                logger.error(f"[match_scenario_to_survey_data] current_sample_row type: {type(current_sample_row)}, attr_col: {attr_col}, attr_col type: {type(attr_col)}")
                row_level_code = ''
            except Exception as e:
                import traceback
                logger.error(f"[match_scenario_to_survey_data] Unexpected error accessing row value for column {attr_col}: {e}")
                logger.error(f"[match_scenario_to_survey_data] Traceback: {traceback.format_exc()}")
                row_level_code = ''
            
            if not row_level_code:
                skipped_no_value += 1
                if is_first_check and total_attributes <= 3:
                    logger.warning(f"[match_scenario_to_survey_data] No value in column {attr_col} for task {task_num}, concept {concept_num}")
                continue
            
            # Find matching level in schema
            schema_levels_raw = schema_attr.get("levels", [])
            # Ensure schema_levels is a list
            if not isinstance(schema_levels_raw, list):
                if isinstance(schema_levels_raw, str):
                    logger.warning(f"[match_scenario_to_survey_data] schema_levels is a string, not a list for attribute {attr_name}. Value: {schema_levels_raw[:100]}")
                    schema_levels = []
                else:
                    logger.warning(f"[match_scenario_to_survey_data] schema_levels is not a list for attribute {attr_name}. Type: {type(schema_levels_raw)}")
                    schema_levels = []
            else:
                schema_levels = schema_levels_raw
            
            matched = False
            for level in schema_levels:
                # Handle both dict and string level formats
                if isinstance(level, dict):
                level_code = str(level.get("code", "")).strip()
                level_text_from_schema = str(level.get("levelText", "")).strip()
                elif isinstance(level, str):
                    # If level is a string, treat it as the level text
                    level_code = ""
                    level_text_from_schema = str(level).strip()
                else:
                    # Skip invalid level format
                    logger.warning(f"[match_scenario_to_survey_data] Invalid level format: {type(level)}, value: {level}")
                    continue
                
                # Match by code first (most reliable)
                if level_code and level_code == row_level_code:
                    match_count += 1
                    matched_attributes_log.append(f"Attr {attr_no_str}: matched by code '{level_code}' (text: {level_text[:40]}...)")
                    matched = True
                    break
                
                # Match by level text (fallback) - compare scenario level text to schema level text
                if level_text_from_schema and level_text_from_schema.lower() == level_text.lower():
                    match_count += 1
                    matched_attributes_log.append(f"Attr {attr_no_str}: matched by text '{level_text[:40]}...'")
                    matched = True
                    break
            
            # Log if no match found for debugging
            if not matched:
                level_text_str = str(level_text)[:50] if level_text else 'None'
                attr_no_display = attr_no_str if attr_no_str else "N/A"
                # Extract schema level codes safely
                schema_level_codes = []
                for l in schema_levels[:3]:
                    if isinstance(l, dict):
                        schema_level_codes.append(str(l.get('code', '')))
                    else:
                        schema_level_codes.append(str(l))
                
                unmatched_attributes_log.append({
                    "attr_no": attr_no_display,
                    "attr_name": attr_name,
                    "scenario_level": level_text_str,
                    "row_value": row_level_code,
                    "schema_level_codes": schema_level_codes
                })
                # Log first few attribute failures for first task/concept combination
                if is_first_check and len(unmatched_attributes_log) <= 5:
                    # Extract level codes safely for logging
                    level_codes_for_log = []
                    for l in schema_levels[:5]:
                        if isinstance(l, dict):
                            level_codes_for_log.append(str(l.get('code', ''))[:10])
                        else:
                            level_codes_for_log.append(str(l)[:10])
                    
                    logger.info(f"[match_scenario_to_survey_data] No match for attr {attr_no_display} '{attr_name}': scenario level='{level_text_str}', row value='{row_level_code}', schema level codes={level_codes_for_log}")
                    if schema_levels:
                        # Extract level texts safely for logging
                        level_texts_for_log = []
                        for l in schema_levels[:3]:
                            if isinstance(l, dict):
                                level_texts_for_log.append(str(l.get('levelText', ''))[:50])
                            else:
                                level_texts_for_log.append(str(l)[:50])
                        logger.info(f"[match_scenario_to_survey_data] Schema level texts (first 3): {level_texts_for_log}")
                    else:
                        logger.warning(f"[match_scenario_to_survey_data] No schema levels found for attribute {attr_name}")
        
        # Store detailed diagnostics for first check
        if is_first_check:
            logger.info(f"[match_scenario_to_survey_data] Processed {total_attributes} attributes for Task {task_num}, Concept {concept_num} (out of {len(scenario)} total)")
            logger.info(f"[match_scenario_to_survey_data] Skipped breakdown: {skipped_no_schema} (no schema), {skipped_no_column} (no column), {skipped_no_value} (no value)")
            if total_attributes == 0:
                logger.warning(f"[match_scenario_to_survey_data] No attributes were processed! All {len(scenario)} scenario attributes were skipped.")
            
            # Build detailed diagnostics
            detailed_diagnostics = {
                "task": int(task_num) if task_num.isdigit() else None,
                "concept": concept_num,
                "rowNumber": row_number,
                "total_attributes": len(scenario),
                "processed_attributes": total_attributes,
                "matched_attributes": match_count,
                "skipped_breakdown": {
                    "no_schema": skipped_no_schema,
                    "no_column": skipped_no_column,
                    "no_value": skipped_no_value
                },
                "columns_found": len(task_concept_cols) if 'task_concept_cols' in locals() and task_concept_cols else 0,
                "sample_columns": sorted(task_concept_cols)[:10] if 'task_concept_cols' in locals() and task_concept_cols else [],
                "unmatched_attributes": unmatched_attributes_log[:5],  # First 5 unmatched
                "matched_attributes_sample": matched_attributes_log[:5]  # First 5 matched
            }
        
        # Calculate match score
        if total_attributes > 0:
            match_score = match_count / total_attributes
            # Log first task/concept checked regardless of score
            if is_first_check:
                logger.warning(f"[match_scenario_to_survey_data] Task {task_num}, Concept {concept_num}: {match_count}/{total_attributes} attributes matched (score: {match_score:.2f})")
                if unmatched_attributes_log:
                    logger.info(f"[match_scenario_to_survey_data] First 3 unmatched attributes for Task {task_num}, Concept {concept_num}:")
                    for unm in unmatched_attributes_log[:3]:
                        logger.info(f"  - Attr {unm['attr_no']} '{unm['attr_name']}': scenario='{unm['scenario_level'][:50]}', row='{unm['row_value']}', schema_codes={unm['schema_level_codes']}")
            if match_score > best_match_score:
                best_match_score = match_score
                best_match = {
                    "task": int(task_num) if task_num.isdigit() else None,
                    "concept": concept_num,
                    "rowNumber": row_number,
                    "matchScore": match_score
                }
                # Log detailed match info for the best match so far
                if match_score >= 0.5:  # Log if at least 50% match
                    logger.info(f"[match_scenario_to_survey_data] Task {task_num}, Concept {concept_num}: {match_count}/{total_attributes} attributes matched (score: {match_score:.2f})")
                    if matched_attributes_log:
                        logger.info(f"[match_scenario_to_survey_data] Matched attributes: {matched_attributes_log[:5]}{'...' if len(matched_attributes_log) > 5 else ''}")
    
    if best_match and best_match_score >= 0.8:  # Require at least 80% match
        logger.info(f"[match_scenario_to_survey_data] Found match: Task {best_match['task']}, Product {best_match['rowNumber']} (match score: {best_match_score:.2f})")
        best_match['matchScore'] = best_match_score
        # Add detailed diagnostics if available
        if detailed_diagnostics:
            best_match['detailed_diagnostics'] = detailed_diagnostics
        return best_match
    else:
        score_to_log = best_match_score if best_match else 0.0
        logger.warning(f"[match_scenario_to_survey_data] No match found (best score: {score_to_log:.2f}, threshold: 0.80)")
        if best_match:
            logger.warning(f"[match_scenario_to_survey_data] Best candidate was Task {best_match['task']}, Concept {best_match['concept']}, Product {best_match['rowNumber']} with {best_match_score*100:.1f}% match")
            # Include best match info in return for diagnostics even if below threshold
            best_match['matchScore'] = best_match_score
            best_match['belowThreshold'] = True
            # Add detailed diagnostics if available
            if detailed_diagnostics:
                best_match['detailed_diagnostics'] = detailed_diagnostics
            # Return best candidate if requested (for diagnostics)
            if return_best_candidate:
                return best_match
        # Return None if not returning best candidate
        return None

def match_scenario_to_design_task(
    scenario: Dict[str, str],
    design_matrix: Optional[List[Dict[str, Any]]] = None,
    schema: Optional[Dict[str, Any]] = None,
    attribute_columns: Optional[List[str]] = None,
    survey_data_rows: Optional[List[Dict[str, Any]]] = None,
    return_best_candidate: bool = False,
    attribute_column_mapping: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """
    Match a scenario (attribute levels) to a task and product.
    
    The design can come from:
    1. A design matrix with Task, Concept, and attribute columns (hATTR_*)
    2. Survey data rows with hATTR_* columns that contain the experimental design
    
    Args:
        scenario: Dictionary mapping attribute names to level text (e.g., {"ON_TABLE_CLOSURE_RATE": "80% On-table closure rate..."})
        design_matrix: List of design matrix rows (each is a dict with Task, Concept, and attribute columns)
        schema: Schema containing attribute definitions with labels
        attribute_columns: List of attribute column names (hATTR_* pattern)
        survey_data_rows: Survey data rows that may contain hATTR_* columns with the design
        return_best_candidate: If True, return best match even if below threshold (for diagnostics)
        
    Returns:
        Dictionary with 'task', 'concept', 'rowNumber' if match found, None otherwise
        If return_best_candidate=True and match is below threshold, returns dict with 'belowThreshold': True
    """
    # If we have survey data with hATTR columns, use that instead of design matrix
    # The survey data contains the actual experimental design
    if survey_data_rows and attribute_columns and len(attribute_columns) > 0 and len(survey_data_rows) > 0:
        logger.info(f"[match_scenario_to_design_task] Using survey data with {len(attribute_columns)} attribute columns for matching")
        result = match_scenario_to_survey_data(
            scenario, 
            survey_data_rows, 
            attribute_columns, 
            schema, 
            return_best_candidate,
            attribute_column_mapping=attribute_column_mapping
        )
        return result
    
    # Fallback to design matrix if provided
    if not design_matrix or len(design_matrix) == 0:
        logger.warning("[match_scenario_to_design_task] No design matrix or survey data available")
        return None
    
    # Build attribute name to code mapping from schema
    # Schema attributes have: name, label, levels
    attr_name_to_schema = {}
    if schema and "attributes" in schema:
        for attr in schema["attributes"]:
            attr_name = attr.get("name", "")
            attr_label = attr.get("label", "")
            # Map both name and label to the schema attribute
            attr_name_to_schema[attr_name] = attr
            attr_name_to_schema[attr_label] = attr
    
    # Find attribute columns in design matrix
    # Try multiple patterns: hATTR_*, ATT*, ATTRIBUTE*, A*, etc.
    first_row = design_matrix[0]
    design_attr_columns = []
    
    if attribute_columns and len(attribute_columns) > 0:
        # Use provided attribute columns if they exist in the design matrix
        design_attr_columns = [col for col in attribute_columns if col in first_row]
        logger.info(f"[match_scenario_to_design_task] Found {len(design_attr_columns)} attribute columns from provided list")
    
    # If no columns found, try to detect them from the design matrix
    if not design_attr_columns:
        # Try various patterns for attribute columns
        all_patterns = [
            r'^hATTR_',           # hATTR_1, hATTR_2, etc.
            r'^ATT\d+$',          # ATT1, ATT2, etc.
            r'^ATTRIBUTE[\s_]?\d+', # ATTRIBUTE1, ATTRIBUTE_1, etc.
            r'^A\d+$',            # A1, A2, etc.
            r'^ATTR\d+',          # ATTR1, ATTR2, etc.
        ]
        
        for pattern in all_patterns:
            matches = [col for col in first_row.keys() if re.match(pattern, col, re.IGNORECASE)]
            if matches:
                design_attr_columns = matches
                logger.info(f"[match_scenario_to_design_task] Found {len(design_attr_columns)} attribute columns using pattern {pattern}")
                break
        
        # If still no columns, log available columns for debugging
        if not design_attr_columns:
            sample_cols = list(first_row.keys())[:20]
            logger.warning(f"[match_scenario_to_design_task] No attribute columns found. Available columns (sample): {sample_cols}")
            return None
    
    # Find Task and Concept columns (try various naming patterns)
    task_col = None
    concept_col = None
    for col in first_row.keys():
        col_lower = col.lower().strip()
        if col_lower == 'task' or col_lower.startswith('task'):
            task_col = col
        elif col_lower in ['concept', 'alt', 'alternative', 'product'] or col_lower.startswith('concept'):
            concept_col = col
    
    if not task_col:
        # Log available columns to help debug
        sample_cols = list(first_row.keys())[:15]
        logger.warning(f"[match_scenario_to_design_task] No Task column found. Available columns (sample): {sample_cols}")
        return None
    
    logger.info(f"[match_scenario_to_design_task] Using Task column: '{task_col}', Concept column: '{concept_col}', Found {len(design_attr_columns)} attribute columns")
    
    # For each scenario attribute, try to find matching level code
    # We need to match scenario attribute names to design matrix columns
    # and scenario level text to level codes in the design matrix
    
    best_match = None
    best_match_score = 0
    
    for row in design_matrix:
        # Only consider Product 4 or Product 5 (concepts 4 or 5, or rowNumber 4 or 5)
        concept_val = str(row.get(concept_col, "")).strip() if concept_col else ""
        # Also check for rowNumber field
        row_number = row.get("rowNumber") or row.get("RowNumber")
        
        # Product 4 and Product 5 are the new products (concepts 4 and 5, or rowNumber 4 and 5)
        is_new_product = (
            concept_val in ["4", "5"] or
            str(row_number) in ["4", "5"] or
            concept_val.lower() in ["product 4", "product 5", "concept 4", "concept 5"]
        )
        
        if not is_new_product:
            continue
        
        # Match scenario attributes to design matrix attribute columns
        match_count = 0
        total_attributes = 0
        
        for attr_name, level_text in scenario.items():
            total_attributes += 1
            
            # Find the schema attribute for this scenario attribute
            schema_attr = attr_name_to_schema.get(attr_name)
            if not schema_attr:
                # Try to find by label match
                for schema_name, schema_attr_candidate in attr_name_to_schema.items():
                    if schema_attr_candidate.get("label", "").lower() == attr_name.lower():
                        schema_attr = schema_attr_candidate
                        break
            
            if not schema_attr:
                skipped_no_schema += 1
                if is_first_check and skipped_no_schema <= 3:
                    logger.warning(f"[match_scenario_to_survey_data] No schema attribute found for '{attr_name}'. Available: {list(attr_name_to_schema.keys())[:5]}...")
                continue
            
            # Find the attribute column in design matrix
            # Map schema attribute to design matrix column (hATTR_1, hATTR_2, etc.)
            # The schema attribute has an attributeNo that should match the number in hATTR_N
            attr_col = None
            attr_no = schema_attr.get("attributeNo") or schema_attr.get("attribute_number")
            
            # Try to find matching hATTR column by attribute number
            if attr_no:
                # hATTR columns follow pattern: hATTR_1, hATTR_2, etc.
                # Match by the number in the column name
                attr_no_str = str(attr_no).strip()
                for design_col in design_attr_columns:
                    # Extract number from column name (e.g., "hATTR_1" -> "1")
                    col_match = re.search(r'(\d+)$', design_col)
                    if col_match and col_match.group(1) == attr_no_str:
                        attr_col = design_col
                        break
                    # Also try case-insensitive match
                    if re.match(r'^hattr_' + attr_no_str + r'$', design_col, re.IGNORECASE):
                        attr_col = design_col
                        break
            
            # Fallback: if no match found, try to match by position/index
            if not attr_col and design_attr_columns:
                # Try to use attribute columns in order if we can't match by number
                # This is less reliable but may work if columns are in attribute order
                attr_col = design_attr_columns[min(len(design_attr_columns) - 1, total_attributes - 1)] if total_attributes > 0 else design_attr_columns[0]
            
            if not attr_col or attr_col not in row:
                continue
            
            # Get the level code from design matrix
            design_level_code = str(row[attr_col]).strip()
            
            # Find matching level in schema
            # The level_text from scenario should match one of the levels in schema
            levels = schema_attr.get("levels", [])
            if isinstance(levels, list) and len(levels) > 0:
                # Check if design_level_code matches any level code, or if level_text matches any level label
                for level in levels:
                    if isinstance(level, dict):
                        level_code = str(level.get("code", "")).strip()
                        level_label = str(level.get("level", "")).strip()
                    else:
                        level_code = str(level).strip()
                        level_label = str(level).strip()
                    
                    # Match by code or by label
                    if (design_level_code == level_code or 
                        level_text.lower() == level_label.lower() or
                        level_text.lower() in level_label.lower() or
                        level_label.lower() in level_text.lower()):
                        match_count += 1
                        break
        
        # Calculate match score
        if total_attributes > 0:
            match_score = match_count / total_attributes
            if match_score > best_match_score:
                best_match_score = match_score
                task_num = str(row[task_col]).strip()
                concept_num = concept_val or str(row_number) if row_number else ""
                
                # Determine rowNumber (4 for Product 4, 5 for Product 5)
                row_num = 4 if concept_num in ["4", "Product 4", "Concept 4"] else 5
                if row_number:
                    try:
                        row_num = int(row_number)
                    except:
                        pass
                
                best_match = {
                    "task": int(task_num) if task_num.isdigit() else None,
                    "concept": concept_num,
                    "rowNumber": row_num,
                    "matchScore": match_score
                }
    
    if best_match and best_match_score >= 0.8:  # Require at least 80% match
        logger.info(f"[match_scenario_to_design_task] Found match: Task {best_match['task']}, Product {best_match['rowNumber']} (match score: {best_match_score:.2f})")
        return best_match
    else:
        score_to_log = best_match_score if best_match else 0.0
        logger.warning(f"[match_scenario_to_design_task] No match found (best score: {score_to_log:.2f})")
        return None

# -------- Endpoints --------
@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - returns API health status"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "0.4.0"
    }

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for monitoring"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "0.4.0"
    }

@app.post("/estimate_from_two_sheets", response_model=EstimateResponse)
async def estimate_from_two_sheets(
    file: UploadFile = File(...),
    resp_col: str = "resp_id",
    task_col: str = "task_id",
    alt_col: str = "alt_id",
    chosen_col: str = "chosen"
):
    """
    Estimate conjoint model from Excel file with two sheets.

    Sheet 1 (Data): Must contain columns for resp_id, task_id, alt_id, chosen, and all attributes
    Sheet 2 (Definitions): Must contain columns: name, type, levels, reference (optional)

    Args:
        file: Excel (.xlsx) file upload
        resp_col: Column name for respondent ID (default: "resp_id")
        task_col: Column name for task ID (default: "task_id")
        alt_col: Column name for alternative ID (default: "alt_id")
        chosen_col: Column name for choice indicator (default: "chosen")

    Returns:
        EstimateResponse with intercept, utilities, schema, and diagnostics
    """
    logger.info(f"Estimation request received: {file.filename}")

    # Validate file type
    if not file.filename.lower().endswith(".xlsx"):
        logger.warning(f"Invalid file type: {file.filename}")
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Check file size
    if file_size > MAX_FILE_SIZE_BYTES:
        logger.warning(f"File too large: {file_size} bytes")
        raise HTTPException(
            status_code=400,
            detail=f"File size ({file_size / 1024 / 1024:.1f}MB) exceeds maximum allowed ({MAX_FILE_SIZE_MB}MB)"
        )

    logger.info(f"File size: {file_size / 1024:.1f}KB")

    # Parse Excel file
    try:
        bio = io.BytesIO(file_content)
        xls = pd.ExcelFile(bio)
        sheets = xls.sheet_names

        if len(sheets) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Workbook must have 2 sheets: data then definitions. Found {len(sheets)} sheet(s)."
            )

        df_data = xls.parse(sheets[0])
        df_defs = xls.parse(sheets[1])

        logger.info(f"Parsed sheets: '{sheets[0]}' ({len(df_data)} rows), '{sheets[1]}' ({len(df_defs)} rows)")

    except Exception as e:
        logger.error(f"Excel parsing error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to read Excel: {str(e)}")

    # Parse attribute definitions
    try:
        attributes = parse_definitions_sheet(df_defs)
        logger.info(f"Found {len(attributes)} attributes: {[a['name'] for a in attributes]}")
    except Exception as e:
        logger.error(f"Definitions parsing error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Definitions error: {str(e)}")

    # Validate required columns
    for col in [resp_col, task_col, alt_col, chosen_col]:
        if col not in df_data.columns:
            logger.error(f"Missing column in data: {col}")
            raise HTTPException(status_code=400, detail=f"Missing required column in data: {col}")

    # Build model and estimate
    try:
        # Prepare data
        df = df_data.dropna(subset=[chosen_col])
        original_rows = len(df_data)
        rows_after_dropna = len(df)

        if rows_after_dropna < original_rows:
            logger.info(f"Dropped {original_rows - rows_after_dropna} rows with missing choice data")

        if rows_after_dropna == 0:
            raise ValueError("No valid choice data found after removing missing values")

        y = df[chosen_col].astype(int)
        X = build_design_matrix(df, attributes_schema)

        logger.info(f"Design matrix: {X.shape[0]} rows × {X.shape[1]} columns")

        # Estimate model
        model = MNLogit(y, X)

        try:
            logger.info("Fitting model with Newton-Raphson...")
            res = model.fit(method="newton", disp=False, maxiter=100)
        except Exception as e:
            logger.warning(f"Newton method failed ({str(e)}), trying BFGS...")
            try:
                res = model.fit(method="bfgs", disp=False, maxiter=200)
            except Exception as e2:
                logger.error(f"BFGS also failed: {str(e2)}")
                raise ValueError(f"Model estimation failed with both methods. Newton: {str(e)}, BFGS: {str(e2)}")

        # Extract coefficients
        if isinstance(res.params, pd.DataFrame):
            coefs = res.params.iloc[:, 0]
        elif isinstance(res.params, pd.Series):
            coefs = res.params
        else:
            coefs = pd.Series(res.params)

        util = coefs.to_dict()

        # Group utilities by attribute
        by_attr: Dict[str, Dict[str, float]] = {}
        for k, v in util.items():
            if k == "const":
                continue
            if "__" in k:
                attr, lvl = k.split("__", 1)
                by_attr.setdefault(attr, {})[lvl] = float(v)

        # Add diagnostics
        log_likelihood = float(res.llf) if hasattr(res, 'llf') else None

        # Check for numerical issues
        if log_likelihood is None or np.isnan(log_likelihood) or np.isinf(log_likelihood):
            logger.error(f"Model estimation failed: numerical issues detected (log-likelihood={log_likelihood})")
            raise ValueError(
                "Model estimation failed due to numerical issues (NaN/Inf). "
                "This usually happens when attributes have too many levels (>20). "
                "Consider recoding your attributes into fewer categories."
            )

        mle_retvals = getattr(res, "mle_retvals", {}) or {}
        diagnostics = {
            "converged": bool(mle_retvals.get('converged', True)),
            "iterations": int(mle_retvals.get('iterations', 0)),
            "method": getattr(res, "method", None),
            "n_observations": int(X.shape[0]),
            "n_parameters": int(X.shape[1]),
            "log_likelihood": log_likelihood,
            "null_log_likelihood": float(res.llnull) if hasattr(res, 'llnull') else None,
            "aic": float(res.aic) if hasattr(res, 'aic') else None,
            "bic": float(res.bic) if hasattr(res, 'bic') else None,
        }

        pseudo_r2 = getattr(res, "prsquared", None)
        if pseudo_r2 is not None and not np.isnan(pseudo_r2):
            diagnostics["pseudo_r2"] = float(pseudo_r2)
        else:
            null_ll = diagnostics.get("null_log_likelihood")
            if null_ll not in (None, 0, 0.0) and not np.isnan(null_ll):
                diagnostics["pseudo_r2"] = 1.0 - (log_likelihood / null_ll)

        logger.info(f"Model estimated successfully. Log-likelihood: {log_likelihood:.2f}")

    except Exception as e:
        logger.error(f"Estimation error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Estimation failed: {str(e)}")

    # Build response
    schema = {
        "attributes": [
            SchemaAttr(
                name=a["name"],
                levels=a["levels"],
                reference=a.get("reference"),
                label=a.get("label")
            ).model_dump()
            for a in attributes_schema
        ]
    }

    return {
        "intercept": float(util.get("const", 0.0)),
        "utilities": by_attr,
        "columns": list(X.columns),
        "schema": schema,
        "diagnostics": diagnostics
    }

@app.post("/simulate", response_model=SimulateResponse)
async def simulate(req: SimulateRequest):
    """
    Simulate market shares for scenarios using estimated utilities.

    Args:
        req: SimulateRequest with intercept, utilities, scenarios, and choice rule

    Returns:
        SimulateResponse with scenario utilities and predicted shares
    """
    logger.info(f"Simulation request: {len(req.scenarios)} scenarios, rule='{req.rule}'")

    # Validate scenarios
    attrs = list(utilities_attrs(req.utilities))

    for idx, s in enumerate(req.scenarios):
        # Check all attributes are present
        missing = [a for a in attrs if a not in s or s[a] is None or str(s[a]).strip() == ""]
        if missing:
            logger.error(f"Scenario {idx} missing attributes: {missing}")
            raise HTTPException(
                status_code=400,
                detail=f"Scenario {idx} is missing required attributes: {missing}"
            )

        # Validate levels are valid (either in utilities or are reference levels)
        for attr, level in s.items():
            if attr in req.utilities:
                valid_levels = list(req.utilities[attr].keys())
                if level not in valid_levels:
                    # Could be reference level - this is allowed
                    logger.debug(f"Scenario {idx}: '{level}' not in estimated levels for '{attr}', assuming reference")

    # Calculate utilities and shares
    try:
        u = scenario_utilities(req.scenarios, req.utilities, req.intercept)

        if req.rule == "first_choice":
            shares = [1.0 if i == int(np.argmax(u)) else 0.0 for i in range(len(u))]
        elif req.rule == "logit":
            shares = softmax(u).tolist()
        else:
            logger.error(f"Unknown rule: {req.rule}")
            raise HTTPException(status_code=400, detail=f"Unknown simulation rule: {req.rule}. Use 'logit' or 'first_choice'.")

        logger.info(f"Simulation complete. Shares: {shares}")

    except Exception as e:
        logger.error(f"Simulation error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Simulation failed: {str(e)}")

    return {"utilities": u.tolist(), "shares": shares}

@app.post("/analyze_scenarios", response_model=ScenarioAnalysisResponse)
async def analyze_scenarios(req: ScenarioAnalysisRequest):
    """
    Analyze market scenarios comparing original market shares with projected scenarios.
    
    This endpoint handles scenario-based market share analysis by:
    1. Processing original market share data
    2. Calculating utilities for new product scenarios
    3. Projecting market shares with new products
    4. Analyzing market impact and changes
    
    Args:
        req: ScenarioAnalysisRequest with utilities, original shares, and new scenarios
        
    Returns:
        ScenarioAnalysisResponse with original scenario, projected scenarios, and market impact
    """
    logger.info(f"Scenario analysis request: {len(req.new_scenarios)} new scenarios, rule='{req.rule}'")
    
    try:
        # Process original market shares
        original_products = []
        original_shares = []
        
        for product in req.original_market_shares:
            original_products.append({
                "name": product.get("name", "Unknown Product"),
                "rowNumber": product.get("rowNumber", 0),
                "currentShare": product.get("currentShare", 0.0)
            })
            original_shares.append(product.get("currentShare", 0.0))
        
        # Normalize original shares to ensure they sum to 1
        original_shares_normalized = normalize_market_shares(original_shares)
        
        # Create original scenario
        original_scenario = MarketShareScenario(
            scenario_name="Original Market",
            products=[
                {**product, "marketShare": share} 
                for product, share in zip(original_products, original_shares_normalized)
            ],
            total_share=sum(original_shares_normalized)
        )
        
        # Process new scenarios
        projected_scenarios = []
        used_survey_data_for_any_scenario = False
        used_survey_data_for_matching_only = False  # Track if we matched successfully even if we didn't use for market shares
        scenario_matching_diagnostics = []  # Track matching diagnostics per scenario
        
        for idx, new_scenario in enumerate(req.new_scenarios):
            scenario_name = f"Scenario {idx + 1}"
            
            # Try to use actual "withNewOptions" survey data by matching scenario to task
            projected_shares = None
            matching_tasks_used = []
            using_survey_data = False
            
            # Check if we have the required data for using survey responses
            has_with_new_options = req.with_new_options_columns and len(req.with_new_options_columns) > 0
            has_survey_rows = req.survey_data_rows and len(req.survey_data_rows) > 0
            has_attribute_columns = req.attribute_columns and len(req.attribute_columns) > 0
            has_design_matrix = req.design_matrix and len(req.design_matrix) > 0
            
            logger.info(f"[analyze_scenarios] Scenario {idx + 1}: has_with_new_options={has_with_new_options} ({len(req.with_new_options_columns) if has_with_new_options else 0} columns), "
                       f"has_survey_rows={has_survey_rows} ({len(req.survey_data_rows) if has_survey_rows else 0} rows), "
                       f"has_attribute_columns={has_attribute_columns} ({len(req.attribute_columns) if has_attribute_columns else 0} columns), "
                       f"has_design_matrix={has_design_matrix} ({len(req.design_matrix) if has_design_matrix else 0} rows)")
            
            # Log design matrix structure for debugging
            if has_design_matrix and len(req.design_matrix) > 0:
                first_design_row = req.design_matrix[0]
                design_cols = list(first_design_row.keys())[:20]
                logger.info(f"[analyze_scenarios] Design matrix columns (sample): {design_cols}")
                # Check if any match attribute patterns
                attr_patterns = [r'^hATTR_', r'^ATT\d+$', r'^ATTRIBUTE', r'^A\d+$']
                for pattern in attr_patterns:
                    matches = [col for col in design_cols if re.match(pattern, col, re.IGNORECASE)]
                    if matches:
                        logger.info(f"[analyze_scenarios] Found columns matching pattern {pattern}: {matches[:5]}")
            
            # Try to match scenario to task/product
            # Use survey data with hATTR columns if available (more reliable than design matrix)
            matched_task_info = None
            best_match_candidate = None
            if has_with_new_options and has_survey_rows and has_attribute_columns:
                # Get attribute column mapping from column_mapping if available
                attribute_column_mapping = None
                if req.column_mapping and isinstance(req.column_mapping, dict):
                    attribute_column_mapping = req.column_mapping.get('attributeColumnMapping')
                    if attribute_column_mapping:
                        logger.info(f"[analyze_scenarios] Using pre-computed attribute column mapping with {len(attribute_column_mapping)} combinations")
                
                matched_task_info = match_scenario_to_design_task(
                    new_scenario,
                    req.design_matrix if has_design_matrix else None,
                    req.schema,
                    req.attribute_columns,
                    req.survey_data_rows,
                    return_best_candidate=True,  # Get best candidate even if below threshold
                    attribute_column_mapping=attribute_column_mapping
                )
                
                # Check if result is below threshold
                if matched_task_info and matched_task_info.get('belowThreshold'):
                    best_match_candidate = matched_task_info
                    matched_task_info = None  # Don't use it for actual matching
                
                # Store best match diagnostics for reporting (even if match failed)
                if not matched_task_info:
                    diag = {
                        "scenario_index": idx + 1,
                        "attempted": True,
                        "matched": False,
                        "has_attribute_columns": has_attribute_columns,
                        "attribute_columns_count": len(req.attribute_columns) if req.attribute_columns else 0
                    }
                    if best_match_candidate:
                        diag["best_candidate"] = {
                            "task": best_match_candidate.get('task'),
                            "concept": best_match_candidate.get('concept'),
                            "rowNumber": best_match_candidate.get('rowNumber'),
                            "matchScore": best_match_candidate.get('matchScore'),
                            "matchPercentage": f"{(best_match_candidate.get('matchScore', 0) * 100):.1f}%"
                        }
                        diag["reason"] = f"Best match was Task {best_match_candidate.get('task')}, Product {best_match_candidate.get('rowNumber')} with {best_match_candidate.get('matchScore', 0)*100:.1f}% match (threshold: 80%)"
                        # Include detailed diagnostics if available
                        if best_match_candidate.get('detailed_diagnostics'):
                            diag["detailed_diagnostics"] = best_match_candidate.get('detailed_diagnostics')
                    else:
                        diag["reason"] = "No task/concept combination found with any match"
                    scenario_matching_diagnostics.append(diag)
                elif matched_task_info:
                    # Also store diagnostics for successful matches
                    diag = {
                        "scenario_index": idx + 1,
                        "attempted": True,
                        "matched": True,
                        "task": matched_task_info.get('task'),
                        "rowNumber": matched_task_info.get('rowNumber'),
                        "matchScore": matched_task_info.get('matchScore')
                    }
                    if matched_task_info.get('detailed_diagnostics'):
                        diag["detailed_diagnostics"] = matched_task_info.get('detailed_diagnostics')
                    scenario_matching_diagnostics.append(diag)
                
                if matched_task_info:
                    # Mark that we successfully matched (even if we don't end up using survey data for market shares)
                    used_survey_data_for_matching_only = True
                    logger.info(f"[analyze_scenarios] ===== Scenario {idx + 1} Matching Summary =====")
                    logger.info(f"[analyze_scenarios] Scenario attributes (sample): {list(new_scenario.items())[:3]}")
                    logger.info(f"[analyze_scenarios] Matched to Task {matched_task_info['task']}, Concept {matched_task_info.get('concept')}, Product {matched_task_info['rowNumber']}, match score: {matched_task_info.get('matchScore', 'N/A')}")
                    if matched_task_info.get('detailed_diagnostics'):
                        diag = matched_task_info['detailed_diagnostics']
                        logger.info(f"[analyze_scenarios] Match details: {diag.get('matched_attributes', 0)}/{diag.get('total_attributes', 0)} attributes matched")
                        if diag.get('matched_attributes_log'):
                            logger.info(f"[analyze_scenarios] Sample matched attributes: {diag['matched_attributes_log'][:3]}")
                    
                    # Extract c2 (withNewOptions) market shares for this task
                    # Find columns for this task and all products
                    task_num = matched_task_info['task']
                    concept_num = matched_task_info.get('concept')
                    matched_row_number = matched_task_info.get('rowNumber')
                    
                    logger.info(f"[analyze_scenarios] Looking for c2 columns for Task {task_num}, Concept {concept_num}, rowNumber {matched_row_number}")
                    
                    c2_columns_by_product = {}  # product rowNumber -> column name
                    
                    for col_info in req.with_new_options_columns:
                        col_task = col_info.get('taskNumber')
                        if col_task == task_num or (isinstance(col_task, (int, float)) and int(col_task) == task_num):
                            row_num = col_info.get('rowNumber')
                            col_name = col_info.get('columnName')
                            
                            # If rowNumber is missing, try to extract it from column name
                            # Pattern: QC2_TrRc2 where T=task, R=row number
                            # Example: QC2_2r1c2 = task 2, row 1, column 2 (c2 = with new options)
                            if not row_num and col_name:
                                match = re.match(r'^QC2_(\d+)r(\d+)c2$', col_name, re.IGNORECASE)
                                if match:
                                    extracted_task = int(match.group(1))
                                    extracted_row = int(match.group(2))
                                    if extracted_task == task_num:
                                        row_num = extracted_row
                                        logger.info(f"[analyze_scenarios] Extracted rowNumber {row_num} from column name {col_name}")
                            
                            if row_num and col_name:
                                c2_columns_by_product[row_num] = col_name
                    
                    logger.info(f"[analyze_scenarios] Found {len(c2_columns_by_product)} c2 columns for Task {task_num}: {list(c2_columns_by_product.keys())}")
                    
                    # If no c2 columns found, log why
                    if not c2_columns_by_product:
                        logger.warning(f"[analyze_scenarios] No c2 columns found for Task {task_num}. Looking for task number {task_num} (type: {type(task_num)}).")
                        logger.warning(f"[analyze_scenarios] Total withNewOptions columns: {len(req.with_new_options_columns) if req.with_new_options_columns else 0}")
                        # Show all unique task numbers in withNewOptions columns
                        if req.with_new_options_columns:
                            unique_tasks = set()
                            for col_info in req.with_new_options_columns:
                                task = col_info.get('taskNumber')
                                if task is not None:
                                    unique_tasks.add(str(task))
                            logger.warning(f"[analyze_scenarios] Available task numbers in withNewOptions: {sorted(list(unique_tasks))[:20]}")
                            # Show sample columns
                            sample_cols = req.with_new_options_columns[:20] if req.with_new_options_columns else []
                            for col_info in sample_cols:
                                logger.warning(f"  - Task {col_info.get('taskNumber')} (type: {type(col_info.get('taskNumber'))}), rowNumber {col_info.get('rowNumber')}, column {col_info.get('columnName')}")
                    
                    # Extract market shares from survey data
                    if c2_columns_by_product:
                        # Convert survey rows to DataFrame for easier processing
                        survey_df = pd.DataFrame(req.survey_data_rows)
                        
                        # Calculate average market shares for each product from c2 columns
                        product_shares = {}
                        logger.info(f"[analyze_scenarios] Extracting market shares from c2 columns for Task {task_num}")
                        logger.info(f"[analyze_scenarios] c2_columns_by_product: {c2_columns_by_product}")
                        for row_num, col_name in c2_columns_by_product.items():
                            if col_name in survey_df.columns:
                                # Extract numeric values, handling missing/empty values
                                shares = pd.to_numeric(survey_df[col_name], errors='coerce').dropna()
                                if len(shares) > 0:
                                    avg_share = float(shares.mean() / 100.0)  # Convert percentage to decimal
                                    product_shares[row_num] = avg_share
                                    logger.info(f"[analyze_scenarios] Product {row_num} (column {col_name}): {len(shares)} respondents, avg share = {avg_share:.4f} ({avg_share*100:.2f}%)")
                                else:
                                    logger.warning(f"[analyze_scenarios] Product {row_num} (column {col_name}): No valid numeric values found")
                            else:
                                logger.warning(f"[analyze_scenarios] Column {col_name} not found in survey data")
                        
                        if not product_shares:
                            logger.warning(f"[analyze_scenarios] No product shares extracted from c2 columns for Task {task_num}. Will fall back to projection method.")
                        
                        # Build projected shares array matching original products order
                        # The c2 columns contain ALL products in the "with new options" scenario, including the new product
                        # Products in c2 that are NOT in original products are the new products
                        if product_shares:
                            projected_shares = []
                            original_row_numbers = [p.get('rowNumber') for p in original_products]
                            
                            # Map original products to their c2 shares
                            for product in original_products:
                                row_num = product.get('rowNumber')
                                # Get c2 share for this product, or use c1 (original) if not found
                                c2_share = product_shares.get(row_num, original_shares_normalized[original_products.index(product)])
                                projected_shares.append(c2_share)
                            
                            # Find new products in c2 data (products that aren't in original products)
                            new_products_in_c2 = [row_num for row_num in product_shares.keys() if row_num not in original_row_numbers]
                            
                            if new_products_in_c2:
                                # Use the first new product (typically there's one, but handle multiple)
                                # Or use the one with the highest share if multiple exist
                                new_product_candidates = [(row_num, product_shares[row_num]) for row_num in new_products_in_c2]
                                new_product_candidates.sort(key=lambda x: x[1], reverse=True)  # Sort by share, highest first
                                new_product_row, new_product_share = new_product_candidates[0]
                                
                            projected_shares.append(new_product_share)
                                logger.info(f"[analyze_scenarios] Added new product {new_product_row} with share {new_product_share:.4f} (from {len(new_products_in_c2)} new products in c2 data)")
                                if len(new_products_in_c2) > 1:
                                    logger.info(f"[analyze_scenarios] Other new products in c2: {[f'{r} ({s:.2%})' for r, s in new_product_candidates[1:]]}")
                            else:
                                # No new products found in c2 - this might be a replacement scenario
                                # The matched product might be replacing an existing one
                                matched_row = matched_task_info.get('rowNumber')
                                if matched_row and matched_row in product_shares:
                                    logger.info(f"[analyze_scenarios] No new products in c2 data. Matched product {matched_row} is updating existing product.")
                                else:
                                    logger.warning(f"[analyze_scenarios] No new products found in c2 data and matched row {matched_row} not in c2 shares")
                            
                            # Normalize to ensure they sum to 1
                            total = sum(projected_shares)
                            if total > 0:
                                projected_shares = [s / total for s in projected_shares]
                                using_survey_data = True
                                used_survey_data_for_any_scenario = True
                                matching_tasks_used = [task_num]
                                logger.info(f"[analyze_scenarios] Scenario {idx + 1} using survey data from Task {task_num}: shares={[f'{s:.4f}' for s in projected_shares]}")
                                logger.info(f"[analyze_scenarios] Product shares extracted from survey data: {product_shares}")
                                logger.info(f"[analyze_scenarios] Original products rowNumbers: {original_row_numbers}")
                                logger.info(f"[analyze_scenarios] New products in c2: {new_products_in_c2}")
                            else:
                                projected_shares = None
            
            # Fallback to projection method if survey data matching failed
            if not using_survey_data:
                logger.info(f"[analyze_scenarios] Using projection method (logit/utilities) for scenario {idx + 1} to get scenario-specific results")
                if matched_task_info:
                    logger.warning(f"[analyze_scenarios] Match found (score={matched_task_info.get('matchScore')}) but not using survey data. Task={matched_task_info.get('task')}, rowNumber={matched_task_info.get('rowNumber')}")
                    if 'c2_columns_by_product' in locals():
                        logger.warning(f"[analyze_scenarios] c2_columns_by_product had {len(c2_columns_by_product)} entries")
                logger.info(f"[analyze_scenarios] Scenario {idx + 1} attributes: {list(new_scenario.keys())}")
                
                # Calculate utility for new product scenario
                new_product_utility = scenario_utilities([new_scenario], req.utilities, req.intercept)[0]
                logger.info(f"[analyze_scenarios] Scenario {idx + 1} new product utility: {new_product_utility:.4f}")
            
            # Use projection method if we didn't get survey data
            if not using_survey_data:
                # Calibrate existing product utilities from observed market shares
                # This ensures that when we apply logit with only existing products, 
                # we get the observed current market shares
                existing_utilities = calibrate_utilities_from_shares(original_shares_normalized)
                
                # Adjust utilities to better reflect preference heterogeneity
                # The issue: when utilities are too similar (from calibration), 
                # redistribution becomes proportional. We need to spread them out
                # while maintaining approximate calibration.
                existing_utilities_array = np.array(existing_utilities)
                
                # Calculate how spread out the utilities are
                utility_std = np.std(existing_utilities_array)
                utility_range = np.max(existing_utilities_array) - np.min(existing_utilities_array)
                
                # If utilities are too compressed (similar), spread them out
                # This will cause non-proportional redistribution when new product is added
                # We use a moderate spread to maintain some calibration while creating differentiation
                if utility_std < 1.0 and utility_range > 0.01:
                    # Spread utilities to create more differentiation
                    # Use a scaling factor that preserves relative order
                    # but amplifies differences for better competition
                    target_std = 1.5  # Target standard deviation for better spread
                    scale = target_std / utility_std if utility_std > 0.01 else 1.0
                    
                    # Scale around the mean to preserve relative positions
                    mean_utility = np.mean(existing_utilities_array)
                    existing_utilities_array = (existing_utilities_array - mean_utility) * scale + mean_utility
                    
                    # Verify the spread worked and update
                    new_std = np.std(existing_utilities_array)
                    if new_std > utility_std:  # Only use if we actually spread them
                        existing_utilities = existing_utilities_array.tolist()
                        logger.info(f"Spread utilities: std {utility_std:.3f} -> {new_std:.3f}, range {utility_range:.3f}")
                
                # Project market shares with new product
                projected_shares = project_market_shares_with_new_product(
                    original_products,
                    new_product_utility,
                    existing_utilities,
                    req.rule
                )
                logger.info(f"[analyze_scenarios] Scenario {idx + 1} projected shares: {[f'{s:.4f}' for s in projected_shares]}")
            
            # Create projected scenario
            projected_products = []
            for i, product in enumerate(original_products):
                projected_products.append({
                    **product,
                    "marketShare": projected_shares[i],
                    "change": projected_shares[i] - original_shares_normalized[i]
                })
            
            # Add new product to projected scenario
            projected_products.append({
                "name": f"New Product {idx + 1}",
                "rowNumber": len(original_products) + idx + 1,
                "currentShare": 0.0,
                "marketShare": projected_shares[-1],
                "change": projected_shares[-1]
            })
            
            projected_scenario = MarketShareScenario(
                scenario_name=scenario_name,
                products=projected_products,
                total_share=sum(projected_shares)
            )
            
            projected_scenarios.append(projected_scenario)
        
        # Calculate market impact for first scenario (if any)
        market_impact = {}
        if projected_scenarios:
            first_projected = projected_scenarios[0]
            original_shares_only = [p["marketShare"] for p in original_scenario.products]
            projected_shares_only = [p["marketShare"] for p in first_projected.products[:-1]]  # Exclude new product
            
            market_impact = calculate_market_impact(original_shares_only, projected_shares_only)
            
            # Add new product impact
            new_product_share = first_projected.products[-1]["marketShare"]
            market_impact["new_product_share"] = new_product_share
            market_impact["market_expansion"] = new_product_share > 0
        
        logger.info(f"Scenario analysis complete: {len(projected_scenarios)} scenarios analyzed")
        
        # Add method information to diagnostics
        # Check if survey data is available for matching (need attribute_columns and survey_data_rows)
        # OR for market share extraction (need with_new_options_columns and survey_data_rows)
        has_survey_data_for_matching = bool(
            req.attribute_columns and len(req.attribute_columns) > 0 and 
            req.survey_data_rows and len(req.survey_data_rows) > 0
        )
        has_survey_data_for_market_shares = bool(
            req.with_new_options_columns and len(req.with_new_options_columns) > 0 and 
            req.survey_data_rows and len(req.survey_data_rows) > 0
        )
        has_survey_data = has_survey_data_for_matching or has_survey_data_for_market_shares
        
        diagnostics = {
            "total_scenarios": len(projected_scenarios),
            "choice_rule": req.rule,
            "analysis_timestamp": datetime.now().isoformat(),
            "has_survey_data": has_survey_data,
            "has_survey_data_for_matching": has_survey_data_for_matching,
            "has_survey_data_for_market_shares": has_survey_data_for_market_shares,
            "with_new_options_columns_count": len(req.with_new_options_columns) if req.with_new_options_columns else 0,
            "survey_data_rows_count": len(req.survey_data_rows) if req.survey_data_rows else 0,
            "attribute_columns_count": len(req.attribute_columns) if req.attribute_columns else 0,
            "used_survey_data_for_matching": used_survey_data_for_any_scenario or used_survey_data_for_matching_only,
            "matching_tasks_used": matching_tasks_used if matching_tasks_used else ([scenario_matching_diagnostics[0].get('task')] if scenario_matching_diagnostics and scenario_matching_diagnostics[0].get('matched') and scenario_matching_diagnostics[0].get('task') is not None else []),
            "matching_diagnostics": scenario_matching_diagnostics[0] if scenario_matching_diagnostics else None
        }
        
        return ScenarioAnalysisResponse(
            original_scenario=original_scenario,
            projected_scenarios=projected_scenarios,
            market_impact=market_impact,
            diagnostics=diagnostics
        )
        
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        logger.error(f"Scenario analysis error: {str(e)}")
        logger.error(f"Traceback: {error_traceback}")
        raise HTTPException(status_code=400, detail=f"Scenario analysis failed: {str(e)}")

@app.post("/process_preprocessed_data", response_model=ScenarioAnalysisResponse)
async def process_preprocessed_data(
    file: UploadFile = File(...),
    utilities: Optional[str] = Form(None),
    original_market_shares: Optional[str] = Form(None),
    new_scenarios: Optional[str] = Form(None),
    rule: str = Form("logit")
):
    """
    Process preprocessed conjoint data with scenario-based market share analysis.
    
    This endpoint is designed to work with the deterministic preprocessing from the Node.js backend.
    It accepts:
    - Preprocessed Excel file with cleaned data
    - Utilities from conjoint estimation
    - Original market share data
    - New product scenarios
    
    Args:
        file: Preprocessed Excel file
        utilities: JSON string of estimated utilities
        original_market_shares: JSON string of original market share data
        new_scenarios: JSON string of new product scenarios
        rule: Choice rule ("logit" or "first_choice")
        
    Returns:
        ScenarioAnalysisResponse with comprehensive market analysis
    """
    logger.info(f"Processing preprocessed data: {file.filename}")
    
    try:
        # Parse JSON inputs
        import json
        
        utilities_dict = {}
        if utilities:
            utilities_dict = json.loads(utilities)
            logger.info(f"Loaded utilities for {len(utilities_dict)} attributes")
        
        original_shares_data = []
        if original_market_shares:
            original_shares_data = json.loads(original_market_shares)
            logger.info(f"Loaded {len(original_shares_data)} original market share products")
        
        new_scenarios_data = []
        if new_scenarios:
            new_scenarios_data = json.loads(new_scenarios)
            logger.info(f"Loaded {len(new_scenarios_data)} new product scenarios")
        
        # Read preprocessed Excel file
        file_content = await file.read()
        bio = io.BytesIO(file_content)
        df = pd.read_excel(bio, sheet_name=0)
        logger.info(f"Read preprocessed data: {df.shape[0]} rows × {df.shape[1]} columns")
        
        # Extract market share data from Excel if not provided in JSON
        if not original_shares_data:
            # Look for market share columns (QC2_*r*c1 for original scenario)
            market_share_cols = [col for col in df.columns if col.startswith('QC2_') and col.endswith('c1')]
            
            if market_share_cols:
                logger.info(f"Found {len(market_share_cols)} original market share columns")
                
                # Calculate average market shares across respondents
                for col in market_share_cols:
                    # Extract product info from column name
                    match = re.match(r'QC2_(\d+)r(\d+)c1', col)
                    if match:
                        task_num = int(match.group(1))
                        row_num = int(match.group(2))
                        
                        # Calculate average market share for this product
                        valid_values = df[col].dropna()
                        numeric_values = pd.to_numeric(valid_values, errors='coerce').dropna()
                        
                        if len(numeric_values) > 0:
                            avg_share = numeric_values.mean() / 100  # Convert percentage to decimal
                            original_shares_data.append({
                                "name": f"Product {row_num}",
                                "rowNumber": row_num,
                                "currentShare": avg_share
                            })
        
        # If we still don't have utilities, try to estimate from choice data
        if not utilities_dict:
            logger.warning("No utilities provided, attempting basic estimation from choice data")
            # This would require implementing a basic choice model estimation
            # For now, we'll use default utilities
            utilities_dict = {
                "Brand": {"Brand A": 0.5, "Brand B": 0.3, "Brand C": 0.2},
                "Price": {"Low": 0.4, "Medium": 0.2, "High": -0.1}
            }
        
        # Create scenario analysis request
        scenario_req = ScenarioAnalysisRequest(
            intercept=0.0,  # Default intercept
            utilities=utilities_dict,
            original_market_shares=original_shares_data,
            new_scenarios=new_scenarios_data,
            rule=rule
        )
        
        # Call the scenario analysis function
        return await analyze_scenarios(scenario_req)
        
    except Exception as e:
        logger.error(f"Preprocessed data processing error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Preprocessed data processing failed: {str(e)}")

def parse_survey_export_to_long(df: pd.DataFrame, attributes_from_design: Optional[List[Dict[str, Any]]] = None) -> tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """
    Convert wide-format survey export to long-format choice data.

    Expected structure:
    - Choice columns: QC1_1, QC1_2, ..., QC1_N (which alternative was chosen)
    - Attribute columns: hATTR_{BRAND}_{TASK}c{SLOT} (attribute codes per brand/concept slot)

    Args:
        df: Wide-format survey data
        attributes_from_design: Optional attribute definitions from design matrix with code->level mapping

    Returns:
        Tuple of (long_format_data, attributes_schema)
    """
    logger.info("Parsing survey export data...")

    def normalize_code(value: Any) -> str:
        if isinstance(value, (int, float)) and not pd.isna(value):
            if float(value).is_integer():
                return str(int(value))
            return str(value)
        return str(value).strip()

    design_lookup: Dict[str, Dict[str, Any]] = {}
    design_lookup_by_no: Dict[str, Dict[str, Any]] = {}
    if attributes_from_design:
        for attr in attributes_from_design:
            attr_name_raw = attr.get('name', '')
            attr_name = str(attr_name_raw or '').strip()
            attr_key = attr_name.upper() if attr_name else ''

            label = str(attr.get('label') or attr.get('attributeText') or attr_name).strip()
            reference = attr.get('reference') or attr.get('referenceLevel')
            reference_str = str(reference).strip() if reference is not None and str(reference).strip() else None

            attr_no_raw = attr.get('attributeNo') or attr.get('attribute_no') or attr.get('attributeNumber')
            attr_no = str(attr_no_raw).strip() if attr_no_raw is not None else ''

            level_names: List[str] = []
            code_map: Dict[str, str] = {}
            levels_data = attr.get('levels', [])
            if isinstance(levels_data, list):
                for level_info in levels_data:
                    if isinstance(level_info, dict):
                        code = str(level_info.get('code', '')).strip()
                        level_name = str(level_info.get('level', '')).strip()
                    else:
                        code = ''
                        level_name = str(level_info).strip()

                    if code:
                        code_map[code] = level_name or code
                    if level_name and level_name not in level_names:
                        level_names.append(level_name)

            if reference_str and reference_str not in level_names:
                level_names.append(reference_str)

            entry_data = {
                "label": label or attr_name or attr_no,
                "reference": reference_str,
                "code_map": code_map,
                "level_names": level_names,
                "schema_name": attr_name or label or (f"ATTR_{attr_no}" if attr_no else attr_key)
            }

            if attr_key:
                design_lookup[attr_key] = entry_data
            if attr_no:
                design_lookup_by_no[attr_no] = entry_data

        logger.info(f"Built code mapping for {len(design_lookup_by_no) or len(design_lookup)} attributes from design")
        
        # Log code_map for first attribute for debugging
        if design_lookup_by_no:
            first_attr_no = list(design_lookup_by_no.keys())[0]
            first_entry = design_lookup_by_no[first_attr_no]
            code_map = first_entry.get('code_map', {})
            logger.info(f"Sample code_map for attribute {first_attr_no} ({first_entry.get('schema_name')}): {dict(list(code_map.items())[:5])}")

    # Try multiple patterns for choice columns
    # Pattern 1: QC1_1, QC1_2, etc. (standard format)
    # Pattern 2: QS3r1, QS3r2, etc. (alternative format)
    # Pattern 3: QC_1r1, QC_2r1, etc. (alternative format with underscore)
    choice_cols = []
    for c in df.columns:
        col_str = str(c).strip()
        if re.match(r'^QC1_\d+$', col_str, re.IGNORECASE):
            choice_cols.append(col_str)
        elif re.match(r'^QS3r\d+$', col_str, re.IGNORECASE):
            choice_cols.append(col_str)
        elif re.match(r'^QC_\d+r1$', col_str, re.IGNORECASE):
            choice_cols.append(col_str)
    
    # Sort choice columns numerically
    def extract_task_num(col_name):
        qc1_match = re.match(r'^QC1_(\d+)$', col_name, re.IGNORECASE)
        if qc1_match:
            return int(qc1_match.group(1))
        qs3_match = re.match(r'^QS3r(\d+)$', col_name, re.IGNORECASE)
        if qs3_match:
            return int(qs3_match.group(1))
        qc_match = re.match(r'^QC_(\d+)r1$', col_name, re.IGNORECASE)
        if qc_match:
            return int(qc_match.group(1))
        return 0
    
    choice_cols.sort(key=extract_task_num)
    n_tasks = len(choice_cols)
    logger.info(f"Found {n_tasks} choice tasks: {choice_cols[:10]}{'...' if n_tasks > 10 else ''}")

    if n_tasks == 0:
        # Check if there are market share columns that might be misidentified
        market_share_cols = [c for c in df.columns if re.match(r'^QC_\d+r\d+c\d+$', str(c), re.IGNORECASE)]
        if market_share_cols:
            logger.warning(f"No choice columns found, but found {len(market_share_cols)} market share columns (e.g., {market_share_cols[:3]})")
            logger.warning("Market share columns (with c1/c2 suffix) cannot be used for utility estimation.")
            logger.warning("Choice columns (without c1/c2 suffix) are required. Expected format: QC_1r1, QC_2r1, etc. or QC1_1, QC1_2, etc.")
        raise ValueError(
            "No choice columns found (expected QC1_1, QC1_2, etc. or QS3r1, QS3r2, etc. or QC_1r1, QC_2r1, etc.). "
            "The file appears to contain market share columns (QC_*r*c*) but not choice columns. "
            "Choice columns are required for utility estimation."
        )

    attr_value_pattern = re.compile(r'^hATTR_([A-Z0-9_]+?)_(\d+)c(\d+)$')
    attr_header_pattern = re.compile(r'^hATTR_([A-Z0-9_]+?)_H_(\d+)c(\d+)$')
    brand_columns: Dict[str, Dict[int, Dict[int, Dict[str, str]]]] = {}

    for col in df.columns:
        header_match = attr_header_pattern.match(col)
        if header_match:
            brand_raw, task_str, slot_str = header_match.groups()
            brand = brand_raw.upper()
            task_num = int(task_str)
            slot_num = int(slot_str)
            task_map = brand_columns.setdefault(brand, {}).setdefault(task_num, {})
            slot_entry = task_map.setdefault(slot_num, {})
            slot_entry['header'] = col
            continue

        value_match = attr_value_pattern.match(col)
        if value_match:
            brand_raw, task_str, slot_str = value_match.groups()
            brand = brand_raw.upper()
            if brand.endswith('_H'):
                continue
            task_num = int(task_str)
            slot_num = int(slot_str)
            task_map = brand_columns.setdefault(brand, {}).setdefault(task_num, {})
            slot_entry = task_map.setdefault(slot_num, {})
            slot_entry['value'] = col

    for brand in list(brand_columns.keys()):
        task_map = brand_columns[brand]
        for task in list(task_map.keys()):
            slot_map = task_map[task]
            for slot in list(slot_map.keys()):
                if 'value' not in slot_map[slot]:
                    slot_map.pop(slot, None)
            if not slot_map:
                task_map.pop(task, None)
        if not task_map:
            brand_columns.pop(brand, None)

    brand_order = list(brand_columns.keys())
    n_alts = len(brand_order)
    logger.info(f"Detected {n_alts} branded alternatives: {brand_order}")

    if n_alts == 0:
        raise ValueError("No attribute columns found (expected hATTR_{BRAND}_{TASK}c{SLOT} pattern)")

    long_data: List[Dict[str, Any]] = []
    attributes_seen: set[str] = set()
    skipped_tasks = 0
    skipped_due_to_missing_alts = 0
    skipped_due_to_choice = 0
    include_none_option = False

    for resp_idx, row in df.iterrows():
        resp_id = resp_idx + 1

        for task_num in range(1, n_tasks + 1):
            choice_col = f'QC1_{task_num}'
            if choice_col not in df.columns:
                continue

            chosen_alt_raw = row[choice_col]
            if pd.isna(chosen_alt_raw):
                continue

            try:
                chosen_alt = int(chosen_alt_raw)
            except (TypeError, ValueError):
                skipped_tasks += 1
                continue

            if chosen_alt < 1:
                skipped_tasks += 1
                continue

            if chosen_alt > n_alts:
                include_none_option = True

            alt_rows_for_task: List[Dict[str, Any]] = []

            for alt_index, brand in enumerate(brand_order, start=1):
                task_slots = brand_columns.get(brand, {}).get(task_num, {})
                if not task_slots:
                    continue

                alt_data = {
                    'resp_id': resp_id,
                    'task_id': task_num,
                    'alt_id': alt_index,
                    'chosen': 1 if alt_index == chosen_alt else 0
                }

                attribute_values_found = False
                has_slots = bool(task_slots)
                for slot in sorted(task_slots.keys()):
                    col_info = task_slots[slot]
                    value_col = col_info.get('value')
                    if not value_col:
                        continue

                    raw_value = row.get(value_col, '')
                    if pd.isna(raw_value) or raw_value == '':
                        continue

                    header_col = col_info.get('header')
                    attr_no = None
                    if header_col:
                        header_value = row.get(header_col, '')
                        if not pd.isna(header_value):
                            header_str = str(header_value).strip()
                            if header_str:
                                attr_no = header_str

                    if not attr_no:
                        normalized = normalize_code(raw_value)
                        if len(normalized) > 1:
                            attr_no = normalized[:-1]

                    design_entry = None
                    if attr_no and attr_no in design_lookup_by_no:
                        design_entry = design_lookup_by_no[attr_no]
                    elif brand in design_lookup:
                        design_entry = design_lookup[brand]

                    if not design_entry:
                        continue

                    level_code = normalize_code(raw_value)
                    code_map = design_entry.get('code_map', {})
                    
                    # The survey data has full codes like "45" (attribute 4, level 5)
                    # But the code_map might have just level numbers like "1", "2", "3", "4", "5"
                    # So we need to extract the level number from the full code
                    level_for_lookup = level_code
                    if attr_no and len(level_code) > len(str(attr_no)):
                        # Try extracting level number: if code is "45" and attr_no is "4", level is "5"
                        level_for_lookup = level_code[len(str(attr_no)):]
                        # Also try the last character if it's a single digit
                        if len(level_code) > 1 and level_code[-1].isdigit():
                            level_for_lookup_single = level_code[-1]
                        else:
                            level_for_lookup_single = level_for_lookup
                    else:
                        level_for_lookup_single = level_code
                    
                    # Try multiple lookup strategies
                    level_name = code_map.get(level_code)  # Try full code first
                    if not level_name:
                        level_name = code_map.get(level_for_lookup)  # Try extracted level
                    if not level_name:
                        level_name = code_map.get(level_for_lookup_single)  # Try single digit
                    if not level_name:
                        # Try with leading/trailing whitespace removed
                        level_name = code_map.get(level_code.strip())
                    if not level_name:
                        level_name = code_map.get(level_for_lookup.strip())
                    if not level_name:
                        # Try converting to int then back to string (in case of type mismatch)
                        try:
                            level_code_int = str(int(level_for_lookup))
                            level_name = code_map.get(level_code_int)
                        except (ValueError, TypeError):
                            pass
                    
                    if not level_name:
                        level_names = design_entry.get('level_names') or []
                        if level_code in level_names:
                            level_name = level_code
                        else:
                            level_name = level_code
                            # Log when code_map lookup fails
                            if len(long_data) < 10 and resp_idx < 2:
                                logger.warning(f"Code '{level_code}' not found in code_map for attr_no={attr_no}, schema_name={design_entry.get('schema_name')}. Tried: '{level_code}', '{level_for_lookup}', '{level_for_lookup_single}'. Available codes: {list(code_map.keys())[:10]}")
                                logger.warning(f"Code_map contents: {dict(list(code_map.items())[:5])}")
                    
                    schema_name = design_entry.get('schema_name') or design_entry.get('label') or attr_no or brand
                    alt_data[schema_name] = level_name
                    attributes_seen.add(schema_name)
                    attribute_values_found = True
                    
                    # Debug logging for first few rows
                    if len(long_data) < 5 and resp_idx < 2:
                        logger.debug(f"Row {len(long_data)}, slot {slot}: attr_no={attr_no}, schema_name={schema_name}, level_code={level_code}, level_name={level_name}, code_map_keys={list(code_map.keys())[:3]}")

                if attribute_values_found or has_slots:
                    alt_rows_for_task.append(alt_data)

            if include_none_option:
                none_alt_id = n_alts + 1
                none_alt_data = {
                    'resp_id': resp_id,
                    'task_id': task_num,
                    'alt_id': none_alt_id,
                    'chosen': 1 if chosen_alt == none_alt_id else 0
                }
                alt_rows_for_task.append(none_alt_data)

            if len(alt_rows_for_task) < 2:
                skipped_due_to_missing_alts += 1
                skipped_tasks += 1
                continue

            if chosen_alt > len(alt_rows_for_task):
                skipped_due_to_choice += 1
                skipped_tasks += 1
                continue

            long_data.extend(alt_rows_for_task)

    if skipped_tasks:
        logger.info(
            "Skipped %s task(s) due to incomplete attribute data or invalid choices "
            "(missing_alternatives=%s, invalid_choice=%s)",
            skipped_tasks,
            skipped_due_to_missing_alts,
            skipped_due_to_choice
        )

    if not long_data:
        raise ValueError("No valid choice data could be constructed from the survey export")

    df_long = pd.DataFrame(long_data)
    logger.info(f"Converted to long format: {len(df_long)} rows and {len(df_long.columns)} columns")
    
    # Log which attributes were actually found in the data
    attribute_cols = [c for c in df_long.columns if c not in ['resp_id', 'task_id', 'alt_id', 'chosen']]
    logger.info(f"Attribute columns in long format ({len(attribute_cols)}): {attribute_cols[:10]}{'...' if len(attribute_cols) > 10 else ''}")
    
    # Check for attributes with no variation
    for col in attribute_cols[:5]:  # Check first 5 for debugging
        unique_vals = df_long[col].nunique()
        logger.info(f"  Column '{col}': {unique_vals} unique values, sample: {list(df_long[col].dropna().unique()[:5])}")

    if attributes_from_design:
        attributes_schema = []
        for attr in attributes_from_design:
            attr_name_raw = attr.get('name', '')
            attr_name = str(attr_name_raw or '').strip()
            attr_key = attr_name.upper()
            attr_no_raw = attr.get('attributeNo') or attr.get('attribute_no') or attr.get('attributeNumber')
            attr_no = str(attr_no_raw).strip() if attr_no_raw is not None else ''

            design_entry = None
            if attr_no and attr_no in design_lookup_by_no:
                design_entry = design_lookup_by_no[attr_no]
            elif attr_key and attr_key in design_lookup:
                design_entry = design_lookup[attr_key]

            if not design_entry:
                continue

            schema_name = design_entry.get('schema_name') or attr_name or attr_key or attr_no
            
            # Get levels from the actual data that was parsed, not from design_entry
            # This ensures we use the same level names that are in the long format data
            if schema_name in df_long.columns:
                levels_series = df_long[schema_name].dropna() if schema_name in df_long.columns else pd.Series(dtype=str)
                seen_levels: List[str] = []
                for val in levels_series.unique():
                    val_str = str(val)
                    if val_str not in seen_levels:
                        seen_levels.append(val_str)
                levels = seen_levels
                logger.info(f"Using levels from data for '{schema_name}': {len(levels)} levels")
            else:
                # Fallback to design_entry or attribute definition
                levels = design_entry.get('level_names') or []
                if not levels:
                    level_values = []
                    levels_data = attr.get('levels', [])
                    if isinstance(levels_data, list):
                        for level_info in levels_data:
                            if isinstance(level_info, dict):
                                level_values.append(str(level_info.get('level', '')).strip())
                            else:
                                level_values.append(str(level_info).strip())
                    levels = [lvl for lvl in level_values if lvl]
                logger.info(f"Using levels from design for '{schema_name}': {len(levels)} levels")

            attributes_schema.append({
                "name": schema_name,
                "levels": levels,
                "reference": design_entry.get('reference'),
                "label": design_entry.get('label')
            })
    else:
        attributes_schema = []
        for schema_name in sorted(attributes_seen):
            levels_series = df_long[schema_name].dropna() if schema_name in df_long.columns else pd.Series(dtype=str)
            seen_levels: List[str] = []
            for val in levels_series:
                val_str = str(val)
                if val_str not in seen_levels:
                    seen_levels.append(val_str)

            attributes_schema.append({
                "name": schema_name,
                "levels": seen_levels,
                "reference": None,
                "label": schema_name
            })

    return df_long, attributes_schema

@app.post("/estimate_from_survey_export", response_model=EstimateResponse)
async def estimate_from_survey_export(
    file: UploadFile = File(...),
    attributes: Optional[str] = Form(None),
    resp_col: str = "resp_id",
    task_col: str = "task_id",
    alt_col: str = "alt_id",
    chosen_col: str = "chosen"
):
    """
    Estimate conjoint model from wide-format survey export Excel file.

    Automatically converts survey data with structure:
    - Choice columns: QC1_1, QC1_2, ..., QC1_N
    - Attribute columns: hATTR_{ATTR}_{TASK}c{ALT}

    Returns:
        EstimateResponse with intercept, utilities, schema, and diagnostics
    """
    logger.info(f"Survey export estimation request: {file.filename}")

    # Validate file type
    if not file.filename.lower().endswith(".xlsx"):
        logger.warning(f"Invalid file type: {file.filename}")
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Check file size
    if file_size > MAX_FILE_SIZE_BYTES:
        logger.warning(f"File too large: {file_size} bytes")
        raise HTTPException(
            status_code=400,
            detail=f"File size ({file_size / 1024 / 1024:.1f}MB) exceeds maximum allowed ({MAX_FILE_SIZE_MB}MB)"
        )

    logger.info(f"File size: {file_size / 1024:.1f}KB")

    # Parse Excel file (use first sheet)
    try:
        bio = io.BytesIO(file_content)
        df_wide = pd.read_excel(bio, sheet_name=0)
        logger.info(f"Read survey data: {df_wide.shape[0]} rows × {df_wide.shape[1]} columns")
        
        # Log sample column names to debug choice column detection
        sample_cols = list(df_wide.columns)[:30]
        logger.info(f"Sample columns from Excel file: {sample_cols}")
        
        # Search all columns for potential choice columns (not just first 30)
        all_cols_str = [str(c) for c in df_wide.columns]
        qc_like_cols = [c for c in all_cols_str if 'QC' in c.upper() and ('1' in c or 'r1' in c or 'R1' in c)]
        if qc_like_cols:
            logger.info(f"Found {len(qc_like_cols)} columns containing 'QC' and '1' or 'r1': {qc_like_cols[:30]}")
        
        # Also check for columns that might be choice columns but with different patterns
        # Look for QC_*r* pattern (without c1/c2 suffix) which would indicate choice
        qc_choice_like = [c for c in all_cols_str if re.match(r'^QC_\d+r\d+$', c, re.IGNORECASE) and not re.match(r'^QC_\d+r\d+c\d+$', c, re.IGNORECASE)]
        if qc_choice_like:
            logger.info(f"Found {len(qc_choice_like)} columns matching QC_*r* (choice-like, no c suffix): {qc_choice_like[:30]}")
        
        # Log all unique QC patterns to understand the structure
        qc_patterns = set()
        for c in all_cols_str:
            if c.upper().startswith('QC'):
                qc_patterns.add(c)
        logger.info(f"All unique QC column patterns (first 50): {sorted(list(qc_patterns))[:50]}")
        
        # Check for choice columns with multiple patterns
        choice_cols_qc1 = [c for c in df_wide.columns if re.match(r'^QC1_\d+$', str(c), re.IGNORECASE)]
        choice_cols_qs3 = [c for c in df_wide.columns if re.match(r'^QS3r\d+$', str(c), re.IGNORECASE)]
        choice_cols_qc = [c for c in df_wide.columns if re.match(r'^QC_\d+r1$', str(c), re.IGNORECASE)]
        choice_cols_found = choice_cols_qc1 + choice_cols_qs3 + choice_cols_qc
        logger.info(f"Choice columns found (QC1_*): {choice_cols_qc1[:10]} ({len(choice_cols_qc1)} total)")
        logger.info(f"Choice columns found (QS3r*): {choice_cols_qs3[:10]} ({len(choice_cols_qs3)} total)")
        logger.info(f"Choice columns found (QC_*r1): {choice_cols_qc[:10]} ({len(choice_cols_qc)} total)")
        logger.info(f"Total choice columns found: {len(choice_cols_found)}")
        
        # Check for any columns starting with QC1, QS3, or QC_
        qc1_cols = [c for c in df_wide.columns if str(c).upper().startswith('QC1')]
        qs3_cols = [c for c in df_wide.columns if str(c).upper().startswith('QS3')]
        qc_cols = [c for c in df_wide.columns if re.match(r'^QC_\d+', str(c), re.IGNORECASE)]
        logger.info(f"All QC1 columns (any pattern): {qc1_cols[:20]} ({len(qc1_cols)} total)")
        logger.info(f"All QS3 columns (any pattern): {qs3_cols[:20]} ({len(qs3_cols)} total)")
        logger.info(f"All QC_* columns (any pattern): {qc_cols[:20]} ({len(qc_cols)} total)")
    except Exception as e:
        logger.error(f"Excel parsing error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to read Excel: {str(e)}")

    # Parse attributes if provided
    attributes_from_design = None
    if attributes:
        try:
            import json
            attributes_from_design = json.loads(attributes)
            logger.info(f"Using attribute definitions from design: {len(attributes_from_design)} attributes")
            # Log first attribute for debugging
            if attributes_from_design and len(attributes_from_design) > 0:
                first_attr = attributes_from_design[0]
                logger.info(f"First attribute: name='{first_attr.get('name')}', levels={len(first_attr.get('levels', []))}")
        except Exception as e:
            logger.warning(f"Failed to parse attributes JSON: {str(e)}")

    # Convert to long format
    try:
        df_long, attributes_schema = parse_survey_export_to_long(df_wide, attributes_from_design)
    except Exception as e:
        logger.error(f"Survey conversion error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Survey conversion failed: {str(e)}")

    # Validate required columns
    for col in [resp_col, task_col, alt_col, chosen_col]:
        if col not in df_long.columns:
            logger.error(f"Missing column after conversion: {col}")
            raise HTTPException(status_code=400, detail=f"Missing required column: {col}")

    # Build model and estimate
    try:
        # Prepare data
        df = df_long.dropna(subset=[chosen_col])
        original_rows = len(df_long)
        rows_after_dropna = len(df)

        if rows_after_dropna < original_rows:
            logger.info(f"Dropped {original_rows - rows_after_dropna} rows with missing choice data")

        if rows_after_dropna == 0:
            raise ValueError("No valid choice data found after removing missing values")

        y = df[chosen_col].astype(int)
        
        # Check for attributes with no variation before building design matrix
        problematic_attrs = []
        for attr in attributes_schema:
            attr_name = attr.get("name")
            if attr_name and attr_name in df.columns:
                unique_values = df[attr_name].nunique()
                value_counts = df[attr_name].value_counts()
                if unique_values <= 1:
                    logger.warning(f"Attribute '{attr_name}' has no variation (only {unique_values} unique value(s)): {dict(value_counts)}")
                    problematic_attrs.append(attr_name)
        
        X = build_design_matrix(df, attributes_schema)

        logger.info(f"Design matrix: {X.shape[0]} rows × {X.shape[1]} columns")
        
        # Check for near-singularity or rank issues
        try:
            rank = np.linalg.matrix_rank(X.values)
            logger.info(f"Design matrix rank: {rank} (columns: {X.shape[1]})")
            if rank < X.shape[1]:
                logger.warning(f"Design matrix is rank-deficient: rank {rank} < {X.shape[1]} columns. This will cause singularity issues.")
                if problematic_attrs:
                    logger.warning(f"Attributes with no variation: {problematic_attrs}")
        except Exception as e:
            logger.warning(f"Could not compute matrix rank: {e}")

        # Estimate model
        model = MNLogit(y, X)

        try:
            logger.info("Fitting model with Newton-Raphson...")
            res = model.fit(method="newton", disp=False, maxiter=100)
        except Exception as e:
            logger.warning(f"Newton method failed ({str(e)}), trying BFGS...")
            try:
                res = model.fit(method="bfgs", disp=False, maxiter=200)
            except Exception as e2:
                logger.error(f"BFGS also failed: {str(e2)}")
                raise ValueError(f"Model estimation failed with both methods. Newton: {str(e)}, BFGS: {str(e2)}")

        # Extract coefficients
        if isinstance(res.params, pd.DataFrame):
            coefs = res.params.iloc[:, 0]
        elif isinstance(res.params, pd.Series):
            coefs = res.params
        else:
            coefs = pd.Series(res.params)

        util = coefs.to_dict()

        # Group utilities by attribute
        by_attr: Dict[str, Dict[str, float]] = {}
        for k, v in util.items():
            if k == "const":
                continue
            if "__" in k:
                attr, lvl = k.split("__", 1)
                by_attr.setdefault(attr, {})[lvl] = float(v)

        # Add diagnostics
        log_likelihood = float(res.llf) if hasattr(res, 'llf') else None

        # Check for numerical issues
        if log_likelihood is None or np.isnan(log_likelihood) or np.isinf(log_likelihood):
            logger.error(f"Model estimation failed: numerical issues detected (log-likelihood={log_likelihood})")
            raise ValueError(
                "Model estimation failed due to numerical issues (NaN/Inf). "
                "This usually happens when attributes have too many levels (>20). "
                "Consider recoding your attributes into fewer categories."
            )

        mle_retvals = getattr(res, "mle_retvals", {}) or {}
        diagnostics = {
            "converged": bool(mle_retvals.get('converged', True)),
            "iterations": int(mle_retvals.get('iterations', 0)),
            "method": getattr(res, "method", None),
            "n_observations": int(X.shape[0]),
            "n_parameters": int(X.shape[1]),
            "log_likelihood": log_likelihood,
            "null_log_likelihood": float(res.llnull) if hasattr(res, 'llnull') else None,
            "aic": float(res.aic) if hasattr(res, 'aic') else None,
            "bic": float(res.bic) if hasattr(res, 'bic') else None,
        }

        pseudo_r2 = getattr(res, "prsquared", None)
        if pseudo_r2 is not None and not np.isnan(pseudo_r2):
            diagnostics["pseudo_r2"] = float(pseudo_r2)
        else:
            null_ll = diagnostics.get("null_log_likelihood")
            if null_ll not in (None, 0, 0.0) and not np.isnan(null_ll):
                diagnostics["pseudo_r2"] = 1.0 - (log_likelihood / null_ll)

        logger.info(f"Model estimated successfully. Log-likelihood: {log_likelihood:.2f}")

    except Exception as e:
        logger.error(f"Estimation error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Estimation failed: {str(e)}")

    # Build response
    schema = {
        "attributes": [
            SchemaAttr(
                name=a["name"],
                levels=a["levels"],
                reference=a.get("reference"),
                label=a.get("label")
            ).model_dump()
            for a in attributes_schema
        ]
    }

    return {
        "intercept": float(util.get("const", 0.0)),
        "utilities": by_attr,
        "columns": list(X.columns),
        "schema": schema,
        "diagnostics": diagnostics
    }

# Startup/shutdown events
@app.on_event("startup")
async def startup_event():
    logger.info("=" * 60)
    logger.info("Conjoint Analysis API starting up")
    logger.info(f"Version: 0.4.0")
    logger.info(f"Max file size: {MAX_FILE_SIZE_MB}MB")
    logger.info(f"Allowed origins: {ALLOWED_ORIGINS}")
    logger.info("=" * 60)

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Conjoint Analysis API shutting down")

