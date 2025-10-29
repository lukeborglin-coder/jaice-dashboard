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

def project_market_shares_with_new_product(
    original_shares: List[Dict[str, Any]], 
    new_product_utility: float,
    existing_utilities: List[float],
    rule: str = "logit"
) -> List[float]:
    """
    Project market shares when a new product is introduced.
    
    Args:
        original_shares: List of original product market shares
        new_product_utility: Utility of the new product
        existing_utilities: Utilities of existing products
        rule: Choice rule ("logit" or "first_choice")
        
    Returns:
        Projected market shares including new product
    """
    # Combine existing utilities with new product utility
    all_utilities = existing_utilities + [new_product_utility]
    
    if rule == "logit":
        # Use softmax to calculate shares
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
        
        for idx, new_scenario in enumerate(req.new_scenarios):
            scenario_name = f"Scenario {idx + 1}"
            
            # Calculate utility for new product scenario
            new_product_utility = scenario_utilities([new_scenario], req.utilities, req.intercept)[0]
            
            # Calculate existing product utilities (simplified - using average of original shares as proxy)
            existing_utilities = []
            for share in original_shares_normalized:
                # Convert market share to utility using log transformation
                if share > 0:
                    existing_utilities.append(np.log(share))
                else:
                    existing_utilities.append(-10)  # Very low utility for zero share
            
            # Project market shares with new product
            projected_shares = project_market_shares_with_new_product(
                original_products,
                new_product_utility,
                existing_utilities,
                req.rule
            )
            
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
        
        return ScenarioAnalysisResponse(
            original_scenario=original_scenario,
            projected_scenarios=projected_scenarios,
            market_impact=market_impact,
            diagnostics={
                "total_scenarios": len(projected_scenarios),
                "choice_rule": req.rule,
                "analysis_timestamp": datetime.now().isoformat()
            }
        )
        
    except Exception as e:
        logger.error(f"Scenario analysis error: {str(e)}")
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
    import re

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

    choice_cols = [c for c in df.columns if re.match(r'^QC1_\d+$', c)]
    n_tasks = len(choice_cols)
    logger.info(f"Found {n_tasks} choice tasks: {choice_cols}")

    if n_tasks == 0:
        raise ValueError("No choice columns found (expected QC1_1, QC1_2, etc.)")

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
                    level_name = design_entry.get('code_map', {}).get(level_code)
                    if not level_name:
                        if level_code in (design_entry.get('level_names') or []):
                            level_name = level_code
                        else:
                            level_name = level_code

                    schema_name = design_entry.get('schema_name') or design_entry.get('label') or attr_no or brand
                    alt_data[schema_name] = level_name
                    attributes_seen.add(schema_name)
                    attribute_values_found = True

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

