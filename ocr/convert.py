import argparse
import ast
import json
import re
from pathlib import Path

import pandas as pd


def parse_json_cell(value):
    if pd.isna(value):
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    text = str(value).strip()
    if text == "" or text == "[]":
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        try:
            data = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            return []
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return data
    return []


def titleize_key(key):
    key = re.sub(r"[_\\-]+", " ", str(key)).strip()
    parts = key.split()
    titled = []
    for part in parts:
        if part.isupper():
            titled.append(part)
        else:
            titled.append(part.capitalize())
    return " ".join(titled)


def make_col_name(prefix, key):
    label = titleize_key(key)
    prefix_lower = prefix.lower()
    label_lower = label.lower()
    if label_lower.startswith(prefix_lower + " "):
        label = label[len(prefix) + 1 :]
    elif label_lower == prefix_lower:
        label = ""
    if label:
        return f"{prefix} {label}"
    return prefix


def normalize_value(value):
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True)
    return value


def join_values(items, key, transform=None):
    values = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw = item.get(key)
        if transform is not None:
            raw = transform(item, raw)
        raw = normalize_value(raw)
        if raw is None:
            continue
        values.append(str(raw))
    if not values:
        return pd.NA
    return "; ".join(values)


def expand_json_column(df, column, prefix, special=None):
    parsed = df[column].apply(parse_json_cell)
    keys = set()
    for items in parsed:
        for item in items:
            if isinstance(item, dict):
                keys.update(item.keys())

    if special == "containers" and "type" in keys:
        keys.remove("type")

    for key in sorted(keys):
        col_name = make_col_name(prefix, key)
        transform = None
        if special == "containers" and key == "number":
            def transform(item, value):
                container_type = item.get("type")
                if container_type:
                    if value:
                        return f"{value}{container_type}"
                    return str(container_type)
                return value
        df[col_name] = parsed.apply(lambda items: join_values(items, key, transform))

    return df.drop(columns=[column])


def process_bill_of_lading(df):
    json_columns = {
        "Containers - All Json": {"prefix": "Container", "special": "containers"},
        "Invoices - All Json": {"prefix": "Invoice", "special": None},
        "Shipping Bills - All Json": {"prefix": "Shipping Bill", "special": None},
    }
    for column, config in json_columns.items():
        if column in df.columns:
            df = expand_json_column(
                df,
                column,
                prefix=config["prefix"],
                special=config["special"],
            )
    return df.drop_duplicates(ignore_index=True)


def find_default_input(data_dir):
    candidates = sorted(Path(data_dir).glob("*.xlsx"))
    if not candidates:
        return None
    return candidates[0]


def build_default_output(input_path):
    path = Path(input_path)
    return path.with_name(f"{path.stem}_converted{path.suffix}")


def main():
    parser = argparse.ArgumentParser(
        description="Expand JSON columns in the Bill of Lading sheet."
    )
    parser.add_argument("--input", help="Path to the input Excel file.")
    parser.add_argument("--output", help="Path to the output Excel file.")
    parser.add_argument("--sheet", default="Bill of Lading", help="Sheet name to process.")
    args = parser.parse_args()

    data_dir = Path("data")
    input_path = args.input or find_default_input(data_dir)
    if not input_path:
        raise SystemExit("No .xlsx file found in the data folder.")

    output_path = args.output or build_default_output(input_path)

    workbook = pd.read_excel(input_path, sheet_name=None)
    if args.sheet not in workbook:
        raise SystemExit(f"Sheet not found: {args.sheet}")

    workbook[args.sheet] = process_bill_of_lading(workbook[args.sheet])

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        for name, frame in workbook.items():
            frame.to_excel(writer, sheet_name=name, index=False)

    print(f"Wrote: {output_path}")


if __name__ == "__main__":
    main()
