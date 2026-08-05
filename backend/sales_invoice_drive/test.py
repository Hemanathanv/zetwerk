from __future__ import annotations

import json
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from pypdf import PdfReader


BASE_DIR = Path(__file__).resolve().parent
SERVICE_ACCOUNT_FILE = BASE_DIR / "service_account.json"
DOWNLOAD_DIR = BASE_DIR / "downloads"
DRIVE_FOLDER_NAME = "sales invoice"
DRIVE_FOLDER_ID = "1IRjTYGPde8LBD1jJVfDUzRmO62cnu3G3"
SCOPES = ("https://www.googleapis.com/auth/drive.readonly",)
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut"
PDF_MIME_TYPE = "application/pdf"


def get_drive_service():
    if not SERVICE_ACCOUNT_FILE.exists() or SERVICE_ACCOUNT_FILE.stat().st_size == 0:
        raise FileNotFoundError(
            f"Service account JSON is missing or empty: {SERVICE_ACCOUNT_FILE}"
        )

    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=SCOPES,
    )
    return build("drive", "v3", credentials=credentials)


def drive_query_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def find_folder_id(service, folder_name: str) -> str:
    if DRIVE_FOLDER_ID:
        print_folder_details(service, DRIVE_FOLDER_ID)
        return DRIVE_FOLDER_ID

    escaped_name = drive_query_literal(folder_name)
    query = (
        "mimeType = 'application/vnd.google-apps.folder' "
        f"and name = '{escaped_name}' "
        "and trashed = false"
    )
    response = (
        service.files()
        .list(
            q=query,
            fields="files(id, name)",
            pageSize=10,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )
    folders = response.get("files", [])
    if not folders:
        folders = search_visible_folders(service, folder_name)
    if not folders:
        service_email = get_service_account_email()
        raise LookupError(
            f"Drive folder not found: {folder_name!r}\n"
            f"Share the Drive folder with this service account email: {service_email}\n"
            "Or paste the folder ID into DRIVE_FOLDER_ID in this script."
        )
    if len(folders) > 1:
        print(f"Found {len(folders)} matching folders; using the first one:")
        for folder in folders:
            print(f"- {folder['name']} ({folder['id']})")
    return folders[0]["id"]


def get_service_account_email() -> str:
    try:
        service_data = json.loads(SERVICE_ACCOUNT_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "[could not read client_email from service_account.json]"
    return str(service_data.get("client_email") or "[client_email missing]")


def search_visible_folders(service, folder_name: str) -> list[dict]:
    words = [word for word in folder_name.split() if word]
    contains_filters = [
        f"name contains '{drive_query_literal(word)}'"
        for word in words
    ]
    name_filter = " and ".join(contains_filters) if contains_filters else "name != ''"
    query = (
        "mimeType = 'application/vnd.google-apps.folder' "
        f"and {name_filter} "
        "and trashed = false"
    )
    response = (
        service.files()
        .list(
            q=query,
            fields="files(id, name)",
            pageSize=20,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )
    folders = response.get("files", [])
    if folders:
        print(f"No exact folder named {folder_name!r}; found these visible matches:")
        for folder in folders:
            print(f"- {folder['name']} ({folder['id']})")
    return folders


def print_folder_details(service, folder_id: str) -> None:
    try:
        folder = (
            service.files()
            .get(
                fileId=folder_id,
                fields="id, name, mimeType, trashed",
                supportsAllDrives=True,
            )
            .execute()
        )
    except Exception as exc:
        service_email = get_service_account_email()
        raise LookupError(
            f"Could not open Drive folder ID {folder_id!r}.\n"
            f"Make sure this folder is shared with: {service_email}"
        ) from exc

    print(
        "Using Drive folder: "
        f"{folder.get('name')} ({folder.get('id')}) "
        f"[{folder.get('mimeType')}]"
    )


def list_folder_children(service, folder_id: str) -> list[dict]:
    query = f"'{folder_id}' in parents and trashed = false"
    children: list[dict] = []
    page_token = None

    while True:
        response = (
            service.files()
            .list(
                q=query,
                fields=(
                    "nextPageToken, "
                    "files(id, name, mimeType, size, shortcutDetails)"
                ),
                pageSize=100,
                pageToken=page_token,
                corpora="allDrives",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        children.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return children


def list_pdf_files(service, folder_id: str) -> list[dict]:
    files = list_folder_children(service, folder_id)

    if not files:
        service_email = get_service_account_email()
        print("No files are visible to the service account inside this folder.")
        print(f"Share the PDF file itself, or the folder, with: {service_email}")
        print("I will now search all visible Drive files for PDFs as a cross-check.")
        visible_pdfs = search_all_visible_pdfs(service)
        if visible_pdfs:
            print("Visible PDFs outside/elsewhere:")
            for pdf_file in visible_pdfs:
                print(f"- {pdf_file['name']} ({pdf_file['id']})")
        return []

    print("Files visible in the Drive folder:")
    for drive_file in files:
        print(f"- {drive_file['name']} [{drive_file.get('mimeType', 'unknown')}]")

    return collect_pdfs_recursively(service, files)


def collect_pdfs_recursively(service, files: list[dict], depth: int = 0) -> list[dict]:
    pdf_files: list[dict] = []
    for drive_file in files:
        mime_type = drive_file.get("mimeType")
        name = str(drive_file.get("name") or "")

        if mime_type == PDF_MIME_TYPE or name.lower().endswith(".pdf"):
            pdf_files.append(drive_file)
            continue

        if mime_type == SHORTCUT_MIME_TYPE:
            shortcut = drive_file.get("shortcutDetails") or {}
            target_mime_type = shortcut.get("targetMimeType")
            target_id = shortcut.get("targetId")
            if target_id and (
                target_mime_type == PDF_MIME_TYPE or name.lower().endswith(".pdf")
            ):
                pdf_files.append(
                    {
                        **drive_file,
                        "id": target_id,
                        "mimeType": target_mime_type,
                    }
                )
            continue

        if mime_type == FOLDER_MIME_TYPE and depth < 5:
            print(f"Scanning subfolder: {name}")
            child_files = list_folder_children(service, drive_file["id"])
            pdf_files.extend(collect_pdfs_recursively(service, child_files, depth + 1))

    return pdf_files


def search_all_visible_pdfs(service) -> list[dict]:
    query = "mimeType = 'application/pdf' and trashed = false"
    response = (
        service.files()
        .list(
            q=query,
            fields="files(id, name, mimeType)",
            pageSize=20,
            corpora="allDrives",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )
    return response.get("files", [])


def download_drive_file(service, file_id: str, file_name: str) -> Path:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target_path = DOWNLOAD_DIR / file_name

    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    with target_path.open("wb") as output_file:
        downloader = MediaIoBaseDownload(output_file, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
            if status:
                print(f"Downloading {file_name}: {int(status.progress() * 100)}%")

    return target_path


def extract_pdf_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    page_text: list[str] = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        page_text.append(f"\n--- Page {page_number} ---\n{text.strip()}")

    return "\n".join(page_text).strip()


def main() -> None:
    service = get_drive_service()
    folder_id = find_folder_id(service, DRIVE_FOLDER_NAME)
    pdf_files = list_pdf_files(service, folder_id)

    if not pdf_files:
        print(f"No PDF files found in Drive folder {DRIVE_FOLDER_NAME!r}.")
        return

    print(f"Found {len(pdf_files)} PDF file(s) in {DRIVE_FOLDER_NAME!r}.")
    for pdf_file in pdf_files:
        file_name = pdf_file["name"]
        file_path = download_drive_file(service, pdf_file["id"], file_name)
        text = extract_pdf_text(file_path)

        print(f"\n\n===== {file_name} =====")
        print(text or "[No extractable text found in this PDF]")


if __name__ == "__main__":
    main()
