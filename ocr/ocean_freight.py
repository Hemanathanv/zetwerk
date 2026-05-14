from pathlib import Path

from structured_ocr import cli_main, extract_ts_map

DOC_TITLE = "Ocean Freight"
SCHEMA_PATH = Path("data/schemas/ocean-freight.json")
PROMPT_TS = Path("src/prompts/ocean-freight-structured-prompt.ts")

SECTION_KEY_MAP = extract_ts_map(PROMPT_TS, "SECTION_JSON_KEY")
FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "FIELD_JSON_KEY")


if __name__ == "__main__":
    cli_main(
        doc_title=DOC_TITLE,
        schema_path=SCHEMA_PATH,
        prompt_ts_path=PROMPT_TS,
        array_sections=["Charges", "Containers", "Tax Summary"],
        key_style="camel",
        section_key_map=SECTION_KEY_MAP,
        field_key_map=FIELD_KEY_MAP,
        expand_array_key="charges",
    )
