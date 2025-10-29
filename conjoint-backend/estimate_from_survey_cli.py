"""Command-line utility to estimate utilities from a survey export workbook.

This mirrors the FastAPI endpoint logic so the Node server can fall back to
local execution when the Python service is unavailable.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from statsmodels.discrete.discrete_model import MNLogit

try:
    # These imports come from the FastAPI service
    from app import build_design_matrix, parse_survey_export_to_long
except Exception as exc:  # pragma: no cover - defensive: missing deps
    raise RuntimeError(
        "Failed to import estimator helpers from app.py. Ensure the "
        "conjoint-backend dependencies are installed."
    ) from exc


def _sanitize_identifier(value: Any, fallback: str = "") -> str:
    """Normalize strings to uppercase snake case identifiers."""
    if not isinstance(value, str):
        return fallback
    cleaned = value.strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned)
    cleaned = cleaned.strip("_").upper()
    return cleaned or fallback


def _transform_flat_attributes(
    flat_attributes: List[Dict[str, Any]],
    attribute_short_names: List[str],
) -> List[Dict[str, Any]]:
    """Mirror the Node transformation to grouped attribute definitions."""
    grouped: Dict[str, Dict[str, Any]] = {}

    for attr in flat_attributes or []:
        if not attr:
            continue
        attr_no = str(
            attr.get("attributeNo") or attr.get("attributeNumber") or ""
        ).strip()
        if not attr_no:
            continue

        code = str(attr.get("code") or "").strip()
        level_text = str(attr.get("levelText") or attr.get("levelName") or "").strip()
        level_no_raw = attr.get("levelNo") or attr.get("levelNumber")
        level_no = None
        if level_no_raw is not None:
            try:
                level_no = float(str(level_no_raw).strip())
            except ValueError:
                level_no = None

        attr_text = str(attr.get("attributeText") or attr.get("attributeName") or "").strip()

        bucket = grouped.setdefault(
            attr_no,
            {"attributeNo": attr_no, "attributeText": attr_text, "levels": []},
        )

        if attr_text and not bucket["attributeText"]:
            bucket["attributeText"] = attr_text

        if code and level_text:
            bucket["levels"].append({"code": code, "level": level_text, "levelNo": level_no})

    result: List[Dict[str, Any]] = []
    used_names: set[str] = set()

    for idx, attr_no in enumerate(sorted(grouped.keys(), key=lambda x: float(x))):
        entry = grouped[attr_no]
        candidate = attribute_short_names[idx] if idx < len(attribute_short_names) else ""
        name = _sanitize_identifier(candidate, f"ATT{idx + 1:02d}")

        base = name
        attempt = 1
        while name in used_names:
            attempt += 1
            name = f"{base}_{attempt}"
        used_names.add(name)

        levels_sorted = sorted(
            entry["levels"],
            key=lambda item: (
                item["levelNo"]
                if isinstance(item.get("levelNo"), (int, float)) and not math.isnan(item["levelNo"])
                else float("inf"),
                float(item["code"]) if str(item["code"]).isdigit() else item["code"],
            ),
        )

        level_defs = [{"code": level["code"], "level": level["level"]} for level in levels_sorted]
        reference = level_defs[-1]["level"] if level_defs else None

        result.append(
            {
                "name": name,
                "label": entry["attributeText"] or name,
                "attributeNo": entry["attributeNo"],
                "levels": level_defs,
                "reference": reference,
            }
        )

    return result


def _extract_attribute_short_names(df: pd.DataFrame) -> List[str]:
    """Derive attribute identifiers from survey export columns."""
    attr_pattern = re.compile(r"^hATTR_(.+?)_(\d+)c(\d+)$", re.IGNORECASE)
    attribute_short_names: List[str] = []
    seen: set[str] = set()

    for column in df.columns:
        match = attr_pattern.match(str(column))
        if not match:
            continue

        short_name = match.group(1).upper()
        if short_name not in seen:
            seen.add(short_name)
            attribute_short_names.append(short_name)

    return attribute_short_names


def _fit_mnlogit(df_long: pd.DataFrame, attributes_schema: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Run the MNLogit estimation and assemble the response payload."""
    df_clean = df_long.dropna(subset=["chosen"])
    if df_clean.empty:
        raise ValueError("No valid choice data found after removing missing values")

    y = df_clean["chosen"].astype(int)
    X = build_design_matrix(df_clean, attributes_schema)

    model = MNLogit(y, X)

    try:
        result = model.fit(method="newton", disp=False, maxiter=100)
    except Exception as first_exc:
        try:
            result = model.fit(method="bfgs", disp=False, maxiter=200)
        except Exception as second_exc:
            raise ValueError(
                f"Model estimation failed with Newton ({first_exc}) and BFGS ({second_exc})."
            ) from second_exc

    if isinstance(result.params, pd.DataFrame):
        coefficients = result.params.iloc[:, 0]
    elif isinstance(result.params, pd.Series):
        coefficients = result.params
    else:
        coefficients = pd.Series(result.params, index=result.model.exog_names)

    util_dict: Dict[str, Dict[str, float]] = {}
    for key, value in coefficients.to_dict().items():
        if key == "const":
            continue
        if "__" in key:
            attr_name, level = key.split("__", 1)
            util_dict.setdefault(attr_name, {})[level] = float(value)

    log_likelihood = float(result.llf) if hasattr(result, "llf") else None
    diagnostics: Dict[str, Any] = {
        "converged": bool(getattr(result, "mle_retvals", {}).get("converged", True)),
        "iterations": int(getattr(result, "mle_retvals", {}).get("iterations", 0)),
        "method": getattr(result, "method", None),
        "n_observations": int(X.shape[0]),
        "n_parameters": int(X.shape[1]),
        "log_likelihood": log_likelihood,
        "null_log_likelihood": float(getattr(result, "llnull", np.nan))
        if hasattr(result, "llnull")
        else None,
        "aic": float(result.aic) if hasattr(result, "aic") else None,
        "bic": float(result.bic) if hasattr(result, "bic") else None,
    }

    pseudo_r2 = getattr(result, "prsquared", None)
    if pseudo_r2 is not None and not np.isnan(pseudo_r2):
        diagnostics["pseudo_r2"] = float(pseudo_r2)
    else:
        null_ll = diagnostics.get("null_log_likelihood")
        if null_ll not in (None, 0, 0.0) and not np.isnan(null_ll):
            diagnostics["pseudo_r2"] = 1.0 - (log_likelihood / null_ll) if log_likelihood is not None else None

    response_schema = {
        "attributes": [
            {
                "name": attr["name"],
                "levels": attr["levels"],
                "reference": attr.get("reference"),
                **({"label": attr.get("label")} if attr.get("label") is not None else {}),
            }
            for attr in attributes_schema
        ]
    }

    return {
        "intercept": float(coefficients.get("const", 0.0)),
        "utilities": util_dict,
        "columns": list(X.columns),
        "schema": response_schema,
        "diagnostics": diagnostics,
        "warnings": [],
    }


def run_estimation(excel_path: Path, attributes_payload: Any) -> Dict[str, Any]:
    """Perform the full estimation pipeline and return the payload."""
    df_wide = pd.read_excel(excel_path)

    if isinstance(attributes_payload, dict) and "attributes" in attributes_payload:
        attributes_grouped = attributes_payload["attributes"]
    else:
        attributes_grouped = attributes_payload

    # If the provided payload looks like the flat stored attributes, transform them.
    if attributes_grouped and isinstance(attributes_grouped[0], dict) and "levels" not in attributes_grouped[0]:
        attribute_short_names = _extract_attribute_short_names(df_wide)
        attributes_grouped = _transform_flat_attributes(attributes_grouped, attribute_short_names)

    df_long, attributes_schema = parse_survey_export_to_long(df_wide, attributes_grouped)
    return _fit_mnlogit(df_long, attributes_schema)


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Estimate utilities from a survey export workbook.")
    parser.add_argument("--excel", required=True, help="Path to the survey export workbook (.xlsx).")
    parser.add_argument(
        "--attributes",
        required=True,
        help="Path to a JSON file containing the grouped attribute definition payload.",
    )

    args = parser.parse_args(argv)

    excel_path = Path(args.excel).resolve()
    attributes_path = Path(args.attributes).resolve()

    if not excel_path.exists():
        parser.error(f"Survey workbook not found: {excel_path}")
    if not attributes_path.exists():
        parser.error(f"Attributes JSON not found: {attributes_path}")

    attributes_payload = json.loads(attributes_path.read_text(encoding="utf-8"))

    try:
        result = run_estimation(excel_path, attributes_payload)
    except Exception as exc:
        error_payload = {
            "error": str(exc),
            "type": exc.__class__.__name__,
        }
        print(json.dumps(error_payload), file=sys.stderr)
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
