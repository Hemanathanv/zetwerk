import os
import re
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

ALLOWED_SENDER = "freshdesk_ops_support@zetwerk.com"
DOWNLOAD_DIR = Path("zohomaildocs")


def sanitize_env_value(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""

    # Remove inline comments when not inside quotes.
    in_single = False
    in_double = False
    out = []
    for ch in text:
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            break
        out.append(ch)

    text = "".join(out).strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        text = text[1:-1].strip()
    return text


def load_env():
    if load_dotenv is not None:
        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)

    config = {
        "CLIENT_ID": sanitize_env_value(os.getenv("CLIENT_ID", "")),
        "CLIENT_SECRET": sanitize_env_value(os.getenv("CLIENT_SECRET", "")),
        "REFRESH_TOKEN": sanitize_env_value(os.getenv("REFRESH_TOKEN", "")),
        "ACCESS_TOKEN": sanitize_env_value(os.getenv("ACCESS_TOKEN", "")),
        "BASE_URL": sanitize_env_value(os.getenv("BASE_URL", "")),
    }

    missing = [k for k in ("CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "BASE_URL") if not config[k]]
    if missing:
        raise SystemExit(f"Missing required .env keys: {', '.join(missing)}")

    base_url = config["BASE_URL"].rstrip("/") + "/"
    return config, base_url


def get_access_token(client_id, client_secret, refresh_token):
    response = requests.post(
        "https://accounts.zoho.in/oauth/v2/token",
        data={
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise SystemExit(f"Failed to refresh access token: {payload}")
    return token


def get_account_id(access_token, base_url):
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    response = requests.get(base_url + "accounts", headers=headers, timeout=30)
    response.raise_for_status()
    payload = response.json()
    accounts = payload.get("data", [])
    if not accounts:
        raise SystemExit(f"No accounts found: {payload}")
    return accounts[0]["accountId"]


def get_folder_id(account_id, access_token, base_url, folder_type="Inbox"):
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    response = requests.get(
        f"{base_url}accounts/{account_id}/folders",
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    folders = response.json().get("data", [])

    for folder in folders:
        if folder.get("folderType") == folder_type:
            print(f"Found folder: {folder.get('folderName')} -> ID: {folder.get('folderId')}")
            return folder["folderId"]

    raise SystemExit(f"Folder type '{folder_type}' not found.")


def read_emails(account_id, folder_id, access_token, base_url, count=10, sender_filter=None):
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    url = f"{base_url}accounts/{account_id}/messages/view"
    params = {
        "folderId": folder_id,
        "limit": count,
        "start": 0,
    }
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    emails = data.get("data", [])
    if sender_filter:
        sender_filter = sender_filter.strip().lower()
        emails = [
            msg
            for msg in emails
            if str(msg.get("fromAddress", "")).strip().lower() == sender_filter
        ]

    if not emails:
        print("No emails matched the sender filter.")
        return

    for msg in emails:
        print(f"From: {msg.get('fromAddress')}")
        print(f"Subject: {msg.get('subject')}")
        print(f"Date: {msg.get('sentDateInGMT')}")
        print("-" * 40)
    return emails


def safe_filename(name: str) -> str:
    text = str(name or "").strip()
    text = text.replace("\\", "_").replace("/", "_")
    text = re.sub(r'[<>:"|?*]+', "_", text)
    return text or "attachment.bin"


def unique_file_path(base_dir: Path, filename: str) -> Path:
    base_dir.mkdir(parents=True, exist_ok=True)
    candidate = base_dir / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    idx = 1
    while True:
        alt = base_dir / f"{stem}_{idx}{suffix}"
        if not alt.exists():
            return alt
        idx += 1


def get_attachment_infos(account_id, folder_id, message_id, access_token, base_url):
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    url = f"{base_url}accounts/{account_id}/folders/{folder_id}/messages/{message_id}/attachmentinfo"
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    payload = response.json().get("data", {})
    return payload.get("attachments", [])


def download_attachment(account_id, folder_id, message_id, attachment_id, access_token, base_url, out_path: Path):
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    url = (
        f"{base_url}accounts/{account_id}/folders/{folder_id}/messages/"
        f"{message_id}/attachments/{attachment_id}"
    )
    response = requests.get(url, headers=headers, timeout=120)
    response.raise_for_status()
    out_path.write_bytes(response.content)
    return out_path


def download_documents_from_emails(account_id, access_token, base_url, emails, output_dir=DOWNLOAD_DIR):
    downloaded = 0
    for msg in emails:
        message_id = msg.get("messageId")
        folder_id = msg.get("folderId")
        subject = msg.get("subject", "")
        if not message_id or not folder_id:
            continue

        attachments = get_attachment_infos(
            account_id=account_id,
            folder_id=folder_id,
            message_id=message_id,
            access_token=access_token,
            base_url=base_url,
        )
        if not attachments:
            continue

        print(f"Downloading {len(attachments)} attachment(s) from: {subject}")
        for attachment in attachments:
            attachment_id = attachment.get("attachmentId")
            attachment_name = safe_filename(attachment.get("attachmentName"))
            if not attachment_id:
                continue
            output_dir.mkdir(parents=True, exist_ok=True)
            if (output_dir / attachment_name).exists():
                print(f"Skipped (already exists): {attachment_name}")
                continue
            target_path = unique_file_path(output_dir, attachment_name)
            download_attachment(
                account_id=account_id,
                folder_id=folder_id,
                message_id=message_id,
                attachment_id=attachment_id,
                access_token=access_token,
                base_url=base_url,
                out_path=target_path,
            )
            downloaded += 1
            print(f"Saved: {target_path}")

    print(f"Total downloaded files: {downloaded}")
    return downloaded


def main():
    config, base_url = load_env()
    token = get_access_token(
        client_id=config["CLIENT_ID"],
        client_secret=config["CLIENT_SECRET"],
        refresh_token=config["REFRESH_TOKEN"],
    )
    account_id = get_account_id(token, base_url=base_url)
    folder_id = get_folder_id(account_id, access_token=token, base_url=base_url, folder_type="Inbox")
    filtered_emails = read_emails(
        account_id,
        folder_id,
        access_token=token,
        base_url=base_url,
        count=200,
        sender_filter=ALLOWED_SENDER,
    )
    if filtered_emails:
        download_documents_from_emails(
            account_id=account_id,
            access_token=token,
            base_url=base_url,
            emails=filtered_emails,
            output_dir=DOWNLOAD_DIR,
        )


if __name__ == "__main__":
    main()
