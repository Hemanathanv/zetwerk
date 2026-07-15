import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import get_prisma
from documents_ocr.cross_validation import (
    RULES,
    load_validation_rule_overrides,
    materialize_rule,
    set_validation_rule_override,
    split_validation_rule_id,
    validation_rule_id,
    validation_rule_row,
)
from helpers.config import settings
from helpers.dependencies import get_admin_user, get_current_user
from helpers.utils import hash_password
from objectstore import delete_document_object, get_download_url, list_buckets, list_prefix

router = APIRouter(prefix=settings.API_SLUG + "/admin", tags=["Admin"])
legacy_router = APIRouter(prefix="/api/admin", tags=["Admin"])


ROLE_DEFINITIONS = [
    {
        "id": "SUPER_ADMIN",
        "name": "Super Admin",
        "roleCategory": "admin",
        "modules": ["dashboard", "reports", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "admin", "settings"],
    },
    {
        "id": "ADMIN",
        "name": "Org Admin",
        "roleCategory": "admin",
        "modules": ["dashboard", "reports", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "admin", "settings"],
    },
    {
        "id": "USER",
        "name": "User",
        "roleCategory": "user",
        "modules": ["dashboard", "reports", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "settings"],
    },
]

ROLE_ALIASES = {
    "role-org-admin": "ADMIN",
    "role-admin": "ADMIN",
    "admin": "ADMIN",
    "org admin": "ADMIN",
    "super_admin": "SUPER_ADMIN",
    "super-admin": "SUPER_ADMIN",
    "super admin": "SUPER_ADMIN",
    "role-super-admin": "SUPER_ADMIN",
    "role-viewer": "USER",
    "role-user": "USER",
    "viewer": "USER",
    "user": "USER",
}

ROLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "SUPER_ADMIN": {
        "name": "Super Admin",
        "description": "Full platform administration.",
        "roleCategory": "platform",
        "color": "#0f766e",
        "allowedLevels": ["L1", "L2", "L3", "L4"],
        "defaultDataScope": "ALL",
        "defaultModules": ROLE_DEFINITIONS[0]["modules"],
        "activityCodes": [
            "admin.manage", "users.manage", "roles.manage", "documents.manage", "shipments.manage",
            "documents.upload", "documents.view_extracted", "documents.edit_extracted",
            "documents.generate_draft", "documents.approve_draft", "documents.override_validation",
            "documents.reprocess_ocr", "documents.download_export", "documents.delete",
        ],
    },
    "ADMIN": {
        "name": "Org Admin",
        "description": "Organisation administration and operations control.",
        "roleCategory": "org_admin",
        "color": "#2563eb",
        "allowedLevels": ["L2", "L3", "L4"],
        "defaultDataScope": "ALL",
        "defaultModules": ROLE_DEFINITIONS[1]["modules"],
        "activityCodes": [
            "users.manage", "roles.view", "documents.manage", "shipments.manage",
            "documents.upload", "documents.view_extracted", "documents.edit_extracted",
            "documents.generate_draft", "documents.approve_draft", "documents.download_export",
        ],
    },
    "USER": {
        "name": "User",
        "description": "Standard operational user.",
        "roleCategory": "org_internal",
        "color": "#64748b",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TEAM",
        "defaultModules": ROLE_DEFINITIONS[2]["modules"],
        "activityCodes": ["documents.view", "shipments.view", "tasks.view"],
    },
}

MODULE_DEFINITIONS = [
    {"id": "module-dashboard", "moduleCode": "dashboard", "displayName": "Dashboard", "icon": "layout-dashboard", "route": "/dashboard", "sortOrder": 10, "isActive": True},
    {"id": "module-shipments", "moduleCode": "shipments", "displayName": "Shipments", "icon": "ship", "route": "/shipments", "sortOrder": 20, "isActive": True},
    {"id": "module-tasks", "moduleCode": "tasks", "displayName": "My Tasks", "icon": "clipboard-list", "route": "/tasks", "sortOrder": 30, "isActive": True},
    {"id": "module-documents", "moduleCode": "documents", "displayName": "Documents", "icon": "file-text", "route": "/documents", "sortOrder": 40, "isActive": True},
    {"id": "module-inventory", "moduleCode": "inventory", "displayName": "Inventory", "icon": "boxes", "route": "/inventory/containers", "sortOrder": 50, "isActive": True},
    {"id": "module-warehouse", "moduleCode": "warehouse", "displayName": "Warehouse", "icon": "warehouse", "route": "/inventory/warehouse", "sortOrder": 60, "isActive": True},
    {"id": "module-dnd", "moduleCode": "dnd", "displayName": "D&D Management", "icon": "dollar-sign", "route": "/inventory/dnd", "sortOrder": 70, "isActive": True},
    {"id": "module-accounting", "moduleCode": "accounting", "displayName": "Accounting", "icon": "receipt", "route": "/accounting", "sortOrder": 80, "isActive": True},
    {"id": "module-reports", "moduleCode": "reports", "displayName": "Reports", "icon": "bar-chart-3", "route": "/reports/dsr", "sortOrder": 90, "isActive": True},
    {"id": "module-partner", "moduleCode": "partner", "displayName": "Partner Portal", "icon": "upload", "route": "/partner", "sortOrder": 100, "isActive": True},
    {"id": "module-portal", "moduleCode": "portal", "displayName": "Customer Portal", "icon": "package", "route": "/portal", "sortOrder": 110, "isActive": True},
    {"id": "module-admin", "moduleCode": "admin", "displayName": "Admin", "icon": "settings", "route": "/settings", "sortOrder": 120, "isActive": True},
    {"id": "module-settings", "moduleCode": "settings", "displayName": "Settings", "icon": "settings", "route": "/settings", "sortOrder": 130, "isActive": True},
]

ACTIVITY_DEFINITIONS = [
    {"id": "activity-shipments-create", "activityCode": "shipments.create", "name": "Create shipments", "category": "shipments", "minLevel": "L2"},
    {"id": "activity-shipments-view", "activityCode": "shipments.view", "name": "View shipments", "category": "shipments", "minLevel": "L1"},
    {"id": "activity-shipments-edit-metadata", "activityCode": "shipments.edit_metadata", "name": "Edit shipment metadata", "category": "shipments", "minLevel": "L2"},
    {"id": "activity-shipments-assign-user", "activityCode": "shipments.assign_user", "name": "Assign shipment users", "category": "shipments", "minLevel": "L3"},
    {"id": "activity-shipments-archive", "activityCode": "shipments.archive", "name": "Archive shipments", "category": "shipments", "minLevel": "L3"},
    {"id": "activity-shipments-delete", "activityCode": "shipments.delete", "name": "Delete shipments", "category": "shipments", "minLevel": "L4"},
    {"id": "activity-shipments-override-blocked-stage", "activityCode": "shipments.override_blocked_stage", "name": "Override blocked shipment stage", "category": "shipments", "minLevel": "L4"},
    {"id": "activity-shipments-tag-partner", "activityCode": "shipments.tag_partner", "name": "Tag partner", "category": "shipments", "minLevel": "L2"},
    {"id": "activity-shipments-manage", "activityCode": "shipments.manage", "name": "Manage shipments", "category": "shipments", "minLevel": "L2"},
    {"id": "activity-documents-upload", "activityCode": "documents.upload", "name": "Upload documents", "category": "documents", "minLevel": "L1", "scopeType": "docType"},
    {"id": "activity-documents-view-extracted", "activityCode": "documents.view_extracted", "name": "View extracted document data", "category": "documents", "minLevel": "L1", "scopeType": "docType"},
    {"id": "activity-documents-edit-extracted", "activityCode": "documents.edit_extracted", "name": "Edit extracted document data", "category": "documents", "minLevel": "L2", "scopeType": "docType"},
    {"id": "activity-documents-generate-draft", "activityCode": "documents.generate_draft", "name": "Generate document drafts", "category": "documents", "minLevel": "L2", "scopeType": "docType"},
    {"id": "activity-documents-approve-draft", "activityCode": "documents.approve_draft", "name": "Approve document drafts", "category": "documents", "minLevel": "L2", "scopeType": "docType"},
    {"id": "activity-documents-override-validation", "activityCode": "documents.override_validation", "name": "Override document validation", "category": "documents", "minLevel": "L3", "scopeType": "docType"},
    {"id": "activity-documents-reprocess-ocr", "activityCode": "documents.reprocess_ocr", "name": "Reprocess OCR", "category": "documents", "minLevel": "L3", "scopeType": "docType"},
    {"id": "activity-documents-download-export", "activityCode": "documents.download_export", "name": "Download document exports", "category": "documents", "minLevel": "L1", "scopeType": "docType"},
    {"id": "activity-documents-delete", "activityCode": "documents.delete", "name": "Delete documents", "category": "documents", "minLevel": "L4", "scopeType": "docType"},
    {"id": "activity-documents-manage", "activityCode": "documents.manage", "name": "Manage documents", "category": "documents", "minLevel": "L2", "scopeType": "docType"},
    {"id": "activity-documents-view", "activityCode": "documents.view", "name": "View documents", "category": "documents", "minLevel": "L1", "scopeType": "docType"},
    {"id": "activity-inventory-view-timeline", "activityCode": "inventory.view_timeline", "name": "View inventory timeline", "category": "inventory", "minLevel": "L1"},
    {"id": "activity-inventory-update-milestone", "activityCode": "inventory.update_milestone", "name": "Update milestones", "category": "inventory", "minLevel": "L2"},
    {"id": "activity-inventory-upload-pod", "activityCode": "inventory.upload_pod", "name": "Upload POD", "category": "inventory", "minLevel": "L2"},
    {"id": "activity-inventory-acknowledge-dnd", "activityCode": "inventory.acknowledge_dnd", "name": "Acknowledge D&D", "category": "inventory", "minLevel": "L2"},
    {"id": "activity-inventory-view-container", "activityCode": "inventory.view_container", "name": "View containers", "category": "inventory", "minLevel": "L1"},
    {"id": "activity-accounting-view-queue", "activityCode": "accounting.view_queue", "name": "View accounting queue", "category": "accounting", "minLevel": "L1"},
    {"id": "activity-accounting-review-ticket", "activityCode": "accounting.review_ticket", "name": "Review tickets", "category": "accounting", "minLevel": "L2"},
    {"id": "activity-accounting-edit-entry", "activityCode": "accounting.edit_entry", "name": "Edit accounting entries", "category": "accounting", "minLevel": "L2"},
    {"id": "activity-accounting-post-to-erp", "activityCode": "accounting.post_to_erp", "name": "Post to ERP", "category": "accounting", "minLevel": "L3"},
    {"id": "activity-accounting-reject-ticket", "activityCode": "accounting.reject_ticket", "name": "Reject tickets", "category": "accounting", "minLevel": "L2"},
    {"id": "activity-accounting-view-ap-aging", "activityCode": "accounting.view_ap_aging", "name": "View AP aging", "category": "accounting", "minLevel": "L1"},
    {"id": "activity-accounting-export-data", "activityCode": "accounting.export_data", "name": "Export accounting data", "category": "accounting", "minLevel": "L2"},
    {"id": "activity-reports-view-dashboard", "activityCode": "reports.view_dashboard", "name": "View report dashboards", "category": "reports", "minLevel": "L1"},
    {"id": "activity-reports-generate-dsr", "activityCode": "reports.generate_dsr", "name": "Generate DSR", "category": "reports", "minLevel": "L2"},
    {"id": "activity-reports-export-report", "activityCode": "reports.export_report", "name": "Export reports", "category": "reports", "minLevel": "L2"},
    {"id": "activity-reports-schedule-auto", "activityCode": "reports.schedule_auto", "name": "Schedule automated reports", "category": "reports", "minLevel": "L3"},
    {"id": "activity-tasks-view", "activityCode": "tasks.view", "name": "View tasks", "category": "tasks", "minLevel": "L1"},
    {"id": "activity-admin-manage", "activityCode": "admin.manage", "name": "Manage administration", "category": "admin", "minLevel": "L3"},
    {"id": "activity-users-manage", "activityCode": "users.manage", "name": "Manage users", "category": "admin", "minLevel": "L3"},
    {"id": "activity-roles-view", "activityCode": "roles.view", "name": "View roles", "category": "admin", "minLevel": "L2"},
    {"id": "activity-roles-manage", "activityCode": "roles.manage", "name": "Manage roles", "category": "admin", "minLevel": "L4"},
    {"id": "activity-admin-manage-users", "activityCode": "admin.manage_users", "name": "Manage users", "category": "admin", "minLevel": "L3"},
    {"id": "activity-admin-configure-roles", "activityCode": "admin.configure_roles", "name": "Configure roles", "category": "admin", "minLevel": "L4"},
    {"id": "activity-admin-edit-workflows", "activityCode": "admin.edit_workflows", "name": "Edit workflows", "category": "admin", "minLevel": "L4"},
    {"id": "activity-admin-configure-doctypes", "activityCode": "admin.configure_doctypes", "name": "Configure document types", "category": "admin", "minLevel": "L3"},
    {"id": "activity-admin-edit-account-mappings", "activityCode": "admin.edit_account_mappings", "name": "Edit account mappings", "category": "admin", "minLevel": "L3"},
    {"id": "activity-admin-manage-partners", "activityCode": "admin.manage_partners", "name": "Manage partners", "category": "admin", "minLevel": "L3"},
    {"id": "activity-admin-view-audit-log", "activityCode": "admin.view_audit_log", "name": "View audit log", "category": "admin", "minLevel": "L3"},
    {"id": "activity-admin-security-settings", "activityCode": "admin.security_settings", "name": "Security settings", "category": "admin", "minLevel": "L4"},
]

ACTIVITY_MODULES = {
    activity["activityCode"]: activity["category"]
    for activity in ACTIVITY_DEFINITIONS
    if activity.get("category") in {module["moduleCode"] for module in MODULE_DEFINITIONS}
}


class StorageFileItem(BaseModel):
    key: str
    name: str
    sizeBytes: int
    lastModified: str | None
    downloadUrl: str
    previewUrl: str | None
    contentType: str | None


class StorageListingResponse(BaseModel):
    bucket: str
    prefix: str
    breadcrumbs: list[str]
    folders: list[str]
    files: list[StorageFileItem]


class BucketListResponse(BaseModel):
    buckets: list[str]


class DeleteFileRequest(BaseModel):
    bucket: str
    key: str


class DeleteDocumentResponse(BaseModel):
    status: str
    message: str
    documentId: str
    deletedObjectKeys: list[str]
    storageDeleteErrors: list[str] = []


class InviteUserRequest(BaseModel):
    email: str
    fullName: str
    roleId: str
    password: str | None = None


class AdminUserRequest(BaseModel):
    email: str | None = None
    fullName: str | None = None
    phone: str | None = None
    roleId: str | None = None
    password: str | None = None
    level: str | None = None
    dataScope: str | None = None
    teamId: str | None = None
    orgId: str | None = None
    geographyOrigin: str | None = None
    geographyDestination: str | None = None
    approvalLimitInr: float | None = None
    approvalLimitUsd: float | None = None
    status: str | None = None


class RoleProfileRequest(BaseModel):
    name: str
    description: str | None = None
    roleCategory: str | None = None
    color: str | None = None
    allowedLevels: list[str] = []
    defaultDataScope: str | None = None
    defaultModules: list[str] = []
    activityCodes: list[str] = []


class TeamRequest(BaseModel):
    name: str
    function: str | None = None
    region: str | None = None


class DelegationRequest(BaseModel):
    delegateId: str
    startDate: str
    endDate: str
    scope: str = "all"
    reason: str | None = None


class UpdateValidationRuleRequest(BaseModel):
    isActive: bool | None = None
    blockingBehavior: str | None = None
    tolerance: float | None = None


VALIDATION_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "breakbulk-template",
        "name": "Breakbulk Template",
        "templateStatus": "ACTIVE",
        "corridor": "INDIA_US",
        "commodity": "STEEL",
    },
    {
        "id": "container-template",
        "name": "Container Template",
        "templateStatus": "ACTIVE",
        "corridor": "INDIA_US",
        "commodity": "STEEL",
    },
]

DOC_TYPE_REGISTRY: list[dict[str, Any]] = [
    {"id": "SALES_INVOICE", "typeCode": "SALES_INVOICE", "displayName": "Sales Invoice", "shortCode": "SI", "geography": "INDIA", "hasExtraction": True, "isSystem": True, "sortOrder": 10},
    {"id": "PACKING_LIST", "typeCode": "PACKING_LIST", "displayName": "Packing List", "shortCode": "PL", "geography": "INDIA", "hasExtraction": True, "isSystem": True, "sortOrder": 20},
    {"id": "BILL_OF_LADING", "typeCode": "BILL_OF_LADING", "displayName": "Bill of Lading", "shortCode": "BOL", "geography": "GLOBAL", "hasExtraction": True, "isSystem": True, "sortOrder": 30},
    {"id": "SHIPPING_BILL", "typeCode": "SHIPPING_BILL", "displayName": "Shipping Bill", "shortCode": "SB", "geography": "INDIA", "hasExtraction": True, "isSystem": True, "sortOrder": 40},
    {"id": "ENTRY_SUMMARY", "typeCode": "ENTRY_SUMMARY", "displayName": "Entry Summary", "shortCode": "BOE", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 50},
    {"id": "CHA_BILL", "typeCode": "CHA_BILL", "displayName": "CHA Bill", "shortCode": "CHA", "geography": "INDIA", "hasExtraction": True, "isSystem": True, "sortOrder": 60},
    {"id": "FREIGHT_FORWARDER_BILL", "typeCode": "FREIGHT_FORWARDER_BILL", "displayName": "Freight Forwarder Bill", "shortCode": "FF", "geography": "GLOBAL", "hasExtraction": True, "isSystem": True, "sortOrder": 70},
    {"id": "OCEAN_FREIGHT", "typeCode": "OCEAN_FREIGHT", "displayName": "Ocean Freight", "shortCode": "OF", "geography": "GLOBAL", "hasExtraction": True, "isSystem": True, "sortOrder": 80},
    {"id": "CUSTOMER_BROKER_BILL", "typeCode": "CUSTOMER_BROKER_BILL", "displayName": "Customer Broker Bill", "shortCode": "CBB", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 90},
    {"id": "GRN_INBOUND", "typeCode": "GRN_INBOUND", "displayName": "GRN Inbound", "shortCode": "GRN", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 100},
    {"id": "PORT_TO_WH", "typeCode": "PORT_TO_WH", "displayName": "Port to WH", "shortCode": "PW", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 110},
    {"id": "WH_TO_CUSTOMER", "typeCode": "WH_TO_CUSTOMER", "displayName": "WH to Customer", "shortCode": "WC", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 120},
    {"id": "US_SALES_INVOICE", "typeCode": "US_SALES_INVOICE", "displayName": "US Sales Invoice", "shortCode": "UI", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 130},
    {"id": "US_PACKING_LIST", "typeCode": "US_PACKING_LIST", "displayName": "US Packing List", "shortCode": "UP", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 140},
    {"id": "US_DELIVERY_ORDER", "typeCode": "US_DELIVERY_ORDER", "displayName": "US Delivery Order", "shortCode": "DO", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 150},
    {"id": "US_CARGO_RELEASE_ORDER", "typeCode": "US_CARGO_RELEASE_ORDER", "displayName": "US Cargo Release", "shortCode": "CR", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 160},
    {"id": "US_CUSTOMS_RELEASE_ORDER", "typeCode": "US_CUSTOMS_RELEASE_ORDER", "displayName": "US Customs Release", "shortCode": "CU", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 170},
    {"id": "ISF", "typeCode": "ISF", "displayName": "ISF", "shortCode": "ISF", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 180},
]

def _role_value(role) -> str:
    return getattr(role, "value", None) or str(role)


def _role_definition(role) -> dict:
    role_value = _role_from_request(_role_value(role))
    return next((item for item in ROLE_DEFINITIONS if item["id"] == role_value), ROLE_DEFINITIONS[-1])


def _role_from_request(role_id: str) -> str:
    normalized = role_id.strip()
    return ROLE_ALIASES.get(normalized.lower(), normalized if normalized in {"SUPER_ADMIN", "ADMIN", "USER"} else "USER")


def _display_role_name(role_name: str) -> str:
    return role_name.replace("_", " ").replace("-", " ").title()


def _role_category(role_name: str) -> str:
    normalized = _role_from_request(role_name)
    if normalized in {"ADMIN", "SUPER_ADMIN"}:
        return "admin"
    return "user"


def _normalize_data_scope(scope: str) -> str:
    normalized = str(scope or "").strip().upper()
    if normalized in {"ALL", "TEAM", "TAGGED"}:
        return normalized
    if normalized in {"ASSIGNED", "ASSIGNED_ONLY"}:
        return "TAGGED"
    return "TEAM"


def _attr_values(attributes: dict | None, key: str) -> list[str]:
    raw = (attributes or {}).get(key)
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item)]
    return [str(raw)] if str(raw) else []


def _attr_value(attributes: dict | None, key: str, default: str = "") -> str:
    values = _attr_values(attributes, key)
    return values[0] if values else default


def _role_id_from_name(name: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in name.strip().upper())
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized.strip("_") or "CUSTOM_ROLE"


def _role_profile_from_keycloak(role: dict, *, user_count: int = 0, detail: bool = False) -> dict[str, Any]:
    role_name = str(role.get("name") or "")
    default_key = role_name if role_name in ROLE_DEFAULTS else ROLE_ALIASES.get(role_name.lower(), "")
    defaults = ROLE_DEFAULTS.get(default_key, {})
    attrs = role.get("attributes") or {}
    modules = _attr_values(attrs, "ewms.modules") or list(defaults.get("defaultModules", []))
    levels = _attr_values(attrs, "ewms.levels") or list(defaults.get("allowedLevels", []))
    activity_codes = _attr_values(attrs, "ewms.activities") or list(defaults.get("activityCodes", []))
    row = {
        "id": role_name,
        "name": _attr_value(attrs, "ewms.displayName", str(defaults.get("name") or _display_role_name(role_name))),
        "displayName": _attr_value(attrs, "ewms.displayName", str(defaults.get("name") or _display_role_name(role_name))),
        "description": role.get("description") or defaults.get("description"),
        "roleCategory": _attr_value(attrs, "ewms.category", str(defaults.get("roleCategory") or _role_category(role_name))),
        "profileCategory": _attr_value(attrs, "ewms.category", str(defaults.get("roleCategory") or _role_category(role_name))),
        "isActive": True,
        "isSystemDefault": default_key in ROLE_DEFAULTS or role_name.lower() in {"admin", "user"},
        "systemCode": default_key if default_key in ROLE_DEFAULTS else None,
        "color": _attr_value(attrs, "ewms.color", str(defaults.get("color") or "#64748b")),
        "allowedLevels": levels,
        "defaultModules": modules,
        "defaultDataScope": _attr_value(attrs, "ewms.dataScope", str(defaults.get("defaultDataScope") or "TEAM")),
        "_count": {"users": user_count, "roleActivities": len(activity_codes)},
    }
    if detail:
        row.update(
            {
                "roleActivities": [
                    {"activity": activity}
                    for activity in ACTIVITY_DEFINITIONS
                    if activity["activityCode"] in activity_codes
                ],
                "docTypePerms": [],
                "ticketPerms": [],
                "gateAssignments": [],
            }
        )
    return row


def _role_payload_from_request(request: RoleProfileRequest, *, role_id: str | None = None) -> dict[str, Any]:
    name = role_id or _role_id_from_name(request.name)
    modules = set(request.defaultModules or [])
    for activity_code in request.activityCodes or []:
        module_code = ACTIVITY_MODULES.get(activity_code)
        if module_code:
            modules.add(module_code)
    return {
        "name": name,
        "description": request.description or "",
        "attributes": {
            "ewms.displayName": [request.name],
            "ewms.category": [request.roleCategory or "org_internal"],
            "ewms.color": [request.color or "#64748b"],
            "ewms.levels": request.allowedLevels or ["L1"],
            "ewms.dataScope": [request.defaultDataScope or "TEAM"],
            "ewms.modules": sorted(modules),
            "ewms.activities": request.activityCodes,
            "ewms.managedBy": ["ewms-admin"],
        },
    }


def _user_attrs(user: dict) -> dict[str, Any]:
    return user.get("attributes") or {}


def _user_attr(user: dict, key: str, default: str = "") -> str:
    return _attr_value(_user_attrs(user), key, default)


def _user_attributes_from_request(request: AdminUserRequest, existing: dict | None = None) -> dict[str, list[str]]:
    attrs = {key: list(value) if isinstance(value, list) else [str(value)] for key, value in (_user_attrs(existing or {}) or {}).items()}
    field_map = {
        "level": ("ewms.level", request.level),
        "dataScope": ("ewms.dataScope", request.dataScope),
        "orgId": ("ewms.orgId", request.orgId),
        "teamId": ("ewms.teamId", request.teamId),
        "geographyOrigin": ("ewms.geographyOrigin", request.geographyOrigin),
        "geographyDestination": ("ewms.geographyDestination", request.geographyDestination),
        "approvalLimitInr": ("ewms.approvalLimitInr", None if request.approvalLimitInr is None else str(request.approvalLimitInr)),
        "approvalLimitUsd": ("ewms.approvalLimitUsd", None if request.approvalLimitUsd is None else str(request.approvalLimitUsd)),
        "phone": ("phone", request.phone),
    }
    sent_fields = getattr(request, "model_fields_set", getattr(request, "__fields_set__", set()))
    fields_to_apply = set(field_map) if existing is None else set(sent_fields)
    for field, (key, value) in field_map.items():
        if field not in fields_to_apply:
            continue
        if value is None or value == "":
            attrs.pop(key, None)
        else:
            attrs[key] = [str(value)]
    return attrs


def _team_row(group: dict, *, user_count: int | None = None) -> dict[str, Any]:
    attrs = group.get("attributes") or {}
    count = user_count
    if count is None:
        count = int(group.get("subGroupCount") or 0)
    return {
        "id": str(group.get("id") or ""),
        "name": str(group.get("name") or ""),
        "orgId": _attr_value(attrs, "ewms.orgId", "default-org"),
        "function": _attr_value(attrs, "ewms.function", ""),
        "region": _attr_value(attrs, "ewms.region", ""),
        "_count": {"users": count},
    }


def _team_payload(request: TeamRequest, existing: dict | None = None) -> dict[str, Any]:
    attrs = dict((existing or {}).get("attributes") or {})
    if request.function:
        attrs["ewms.function"] = [request.function]
    else:
        attrs.pop("ewms.function", None)
    if request.region:
        attrs["ewms.region"] = [request.region]
    else:
        attrs.pop("ewms.region", None)
    attrs.setdefault("ewms.orgId", ["default-org"])
    attrs["ewms.kind"] = ["team"]
    return {"name": request.name.strip(), "attributes": attrs}


def _template_exists(template_id: str) -> bool:
    return any(template["id"] == template_id for template in VALIDATION_TEMPLATES)


def _validation_rule_id(template_id: str, rule_code: str) -> str:
    return validation_rule_id(template_id, rule_code)


def _split_validation_rule_id(rule_id: str) -> tuple[str, str]:
    try:
        return split_validation_rule_id(rule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Validation rule not found")


def _validation_rule_row(template_id: str, rule) -> dict[str, Any]:
    return validation_rule_row(rule, template_id=template_id)


def _active_validation_count() -> int:
    return sum(1 for rule in RULES if materialize_rule(rule).active)


def _admin_display_name(user) -> str:
    return str(getattr(user, "name", None) or getattr(user, "email", None) or getattr(user, "id", "") or "admin user")


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    return [dict(row) for row in await query_raw(sql, *params)]


async def _execute_raw(prisma, sql: str, *params) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


async def _ensure_validation_rule_override_table(prisma) -> None:
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_module"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."validation_rule_overrides" (
          "template_id" TEXT NOT NULL,
          "rule_code" TEXT NOT NULL,
          "is_active" BOOLEAN,
          "blocking_behavior" TEXT,
          "tolerance" DOUBLE PRECISION,
          "status_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("template_id", "rule_code")
        )
        """,
    )


async def _load_validation_rule_overrides_from_db(prisma) -> None:
    await _ensure_validation_rule_override_table(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT "template_id", "rule_code", "is_active", "blocking_behavior",
               "tolerance", "status_history", "updated_at"
        FROM "document_module"."validation_rule_overrides"
        """,
    )
    overrides: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        override: dict[str, Any] = {}
        if row.get("is_active") is not None:
            override["isActive"] = bool(row["is_active"])
        if row.get("blocking_behavior"):
            override["blockingBehavior"] = str(row["blocking_behavior"])
        if row.get("tolerance") is not None:
            override["tolerance"] = float(row["tolerance"])
        override["statusHistory"] = row.get("status_history") or []
        updated_at = row.get("updated_at")
        override["updatedAt"] = updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at
        overrides[(str(row["template_id"]), str(row["rule_code"]))] = override
    load_validation_rule_overrides(overrides)


async def _persist_validation_rule_override(prisma, *, row: dict[str, Any]) -> None:
    await _ensure_validation_rule_override_table(prisma)
    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_module"."validation_rule_overrides" (
          "template_id", "rule_code", "is_active", "blocking_behavior",
          "tolerance", "status_history", "updated_at"
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
        ON CONFLICT ("template_id", "rule_code") DO UPDATE SET
          "is_active" = EXCLUDED."is_active",
          "blocking_behavior" = EXCLUDED."blocking_behavior",
          "tolerance" = EXCLUDED."tolerance",
          "status_history" = EXCLUDED."status_history",
          "updated_at" = NOW()
        """,
        str(row["templateId"]),
        str(row["ruleCode"]),
        bool(row["isActive"]),
        str(row["blockingBehavior"]),
        row.get("tolerance"),
        json.dumps(row.get("statusHistory") or []),
    )


@router.get("/templates")
@legacy_router.get("/templates")
async def list_admin_templates(_user=Depends(get_admin_user)):
    return {"ok": True, "data": VALIDATION_TEMPLATES}


@router.get("/registries/doc-types")
@legacy_router.get("/registries/doc-types")
async def list_admin_doc_types(_user=Depends(get_admin_user)):
    return {"ok": True, "data": sorted(DOC_TYPE_REGISTRY, key=lambda item: int(item["sortOrder"]))}


@router.get("/registries/partner-types")
@legacy_router.get("/registries/partner-types")
async def list_admin_partner_types(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.get("/registries/ticket-categories")
@legacy_router.get("/registries/ticket-categories")
async def list_admin_ticket_categories(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.get("/registries/modules")
@legacy_router.get("/registries/modules")
async def list_admin_modules(_user=Depends(get_admin_user)):
    return {"ok": True, "data": MODULE_DEFINITIONS}


@router.get("/organisations")
@legacy_router.get("/organisations")
async def list_admin_organisations(_user=Depends(get_admin_user)):
    return {"ok": True, "data": [{"id": "default-org", "name": "Your Organisation", "isActive": True}]}


@router.get("/teams")
@legacy_router.get("/teams")
async def list_admin_teams(_user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        groups = keycloak_admin.get_groups({})
        rows = []
        for group in groups:
            attrs = group.get("attributes") or {}
            if _attr_value(attrs, "ewms.kind") and _attr_value(attrs, "ewms.kind") != "team":
                continue
            members = keycloak_admin.get_group_members(group["id"])
            rows.append(_team_row(group, user_count=len(members or [])))
        rows.sort(key=lambda item: item["name"].lower())
        return {"ok": True, "data": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load Keycloak teams: {exc}")


@router.post("/teams")
@legacy_router.post("/teams")
async def create_admin_team(request: TeamRequest, _user=Depends(get_admin_user)):
    if not request.name.strip():
        return {"ok": False, "error": "Team name is required."}
    keycloak_admin = get_keycloak_admin()
    try:
        group_id = keycloak_admin.create_group(_team_payload(request), skip_exists=True)
        if not group_id:
            group = keycloak_admin.get_group_by_path(f"/{request.name.strip()}")
            group_id = group.get("id")
        group = keycloak_admin.get_group(group_id)
        return {"ok": True, "data": _team_row(group, user_count=0)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create Keycloak team: {exc}")


@router.put("/teams/{team_id}")
@legacy_router.put("/teams/{team_id}")
async def update_admin_team(team_id: str, request: TeamRequest, _user=Depends(get_admin_user)):
    if not request.name.strip():
        return {"ok": False, "error": "Team name is required."}
    keycloak_admin = get_keycloak_admin()
    try:
        existing = keycloak_admin.get_group(team_id)
        keycloak_admin.update_group(team_id, _team_payload(request, existing=existing))
        group = keycloak_admin.get_group(team_id)
        members = keycloak_admin.get_group_members(team_id)
        return {"ok": True, "data": _team_row(group, user_count=len(members or []))}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update Keycloak team: {exc}")


@router.delete("/teams/{team_id}")
@legacy_router.delete("/teams/{team_id}")
async def delete_admin_team(team_id: str, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        members = keycloak_admin.get_group_members(team_id)
        if members:
            return {"ok": False, "error": "Team has users assigned. Reassign them before deleting."}
        keycloak_admin.delete_group(team_id)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete Keycloak team: {exc}")


@router.get("/activities")
@legacy_router.get("/activities")
async def list_admin_activities(_user=Depends(get_admin_user)):
    return {"ok": True, "data": ACTIVITY_DEFINITIONS}


@router.get("/partners")
@legacy_router.get("/partners")
async def list_admin_partners(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.get("/settings/team-overview")
@legacy_router.get("/settings/team-overview")
async def get_team_overview(_user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        users = keycloak_admin.get_users({})
        groups = keycloak_admin.get_groups({})
        active_users = [user for user in users if user.get("enabled", False)]
        admin_users = 0
        partner_users = 0
        override_users = 0
        for user in active_users:
            user = keycloak_admin.get_user(user["id"])
            roles = [str(role.get("name") or "") for role in keycloak_admin.get_realm_roles_of_user(user["id"])]
            if _local_role_from_keycloak_roles(roles, str(user.get("email") or "")) in {"ADMIN", "SUPER_ADMIN"}:
                admin_users += 1
            attrs = _user_attrs(user)
            if _attr_value(attrs, "ewms.userType", "internal") != "internal":
                partner_users += 1
            if _attr_value(attrs, "ewms.approvalLimitInr") or _attr_value(attrs, "ewms.approvalLimitUsd"):
                override_users += 1
        team_count = sum(
            1
            for group in groups
            if _attr_value(group.get("attributes") or {}, "ewms.kind", "team") == "team"
        )
        return {
            "ok": True,
            "data": {
                "activeUsers": len(active_users),
                "partnerUsers": partner_users,
                "adminUsers": admin_users,
                "teamCount": team_count,
                "overrideUsers": override_users,
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load Keycloak access overview: {exc}")


@router.get("/settings/access-audit")
@legacy_router.get("/settings/access-audit")
async def list_access_audit(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.get("/delegations")
@legacy_router.get("/delegations")
async def list_admin_delegations(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.post("/users/{user_id}/delegate")
@legacy_router.post("/users/{user_id}/delegate")
async def create_admin_delegation(user_id: str, request: DelegationRequest, _user=Depends(get_admin_user)):
    return {
        "ok": True,
        "data": {
            "id": f"{user_id}:{request.delegateId}:{request.startDate}",
            "delegatorId": user_id,
            "delegateId": request.delegateId,
            "startDate": request.startDate,
            "endDate": request.endDate,
            "isActive": True,
            "scope": request.scope,
            "reason": request.reason,
        },
    }


@router.delete("/delegations/{delegation_id}")
@legacy_router.delete("/delegations/{delegation_id}")
async def delete_admin_delegation(delegation_id: str, _user=Depends(get_admin_user)):
    return {"ok": True}


@router.get("/settings/setup-status")
@legacy_router.get("/settings/setup-status")
async def get_admin_setup_status(_user=Depends(get_admin_user)):
    prisma = await get_prisma()
    await _load_validation_rule_overrides_from_db(prisma)
    return {
        "ok": True,
        "data": {
            "orgProfile": True,
            "orgName": "Your Organisation",
            "userCount": 1,
            "rolesConfigured": True,
            "roleWarnings": [],
            "teamCount": 0,
            "templateCount": len(VALIDATION_TEMPLATES),
            "templateName": VALIDATION_TEMPLATES[0]["name"],
            "docTypeCount": len(DOC_TYPE_REGISTRY),
            "validationCount": _active_validation_count(),
            "triggerCount": 0,
            "dndRateCount": 0,
            "ocrConnected": True,
        },
    }


@router.get("/validation-rules")
@legacy_router.get("/validation-rules")
async def list_validation_rules(templateId: str = Query(...), _user=Depends(get_admin_user)):
    if not _template_exists(templateId):
        raise HTTPException(status_code=404, detail="Workflow template not found")
    prisma = await get_prisma()
    await _load_validation_rule_overrides_from_db(prisma)
    return {
        "ok": True,
        "data": [_validation_rule_row(templateId, rule) for rule in RULES],
    }


@router.put("/validation-rules/{rule_id}")
@legacy_router.put("/validation-rules/{rule_id}")
async def update_validation_rule(
    rule_id: str,
    request: UpdateValidationRuleRequest,
    user=Depends(get_admin_user),
):
    template_id, rule_code = _split_validation_rule_id(rule_id)
    if not _template_exists(template_id):
        raise HTTPException(status_code=404, detail="Workflow template not found")
    rule = next((item for item in RULES if item.rule_code == rule_code), None)
    if rule is None:
        raise HTTPException(status_code=404, detail="Validation rule not found")

    prisma = await get_prisma()
    await _load_validation_rule_overrides_from_db(prisma)
    try:
        row = set_validation_rule_override(
            template_id=template_id,
            rule=rule,
            is_active=request.isActive,
            blocking_behavior=request.blockingBehavior,
            tolerance=request.tolerance,
            changed_by_id=str(getattr(user, "id", "")),
            changed_by_name=_admin_display_name(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _persist_validation_rule_override(prisma, row=row)
    return {"ok": True, "data": row}


def _local_role_from_keycloak_roles(roles: list[str], email: str = "") -> str:
    if email.lower() == "admin@sprconsultech.com":
        return "ADMIN"
    normalized = {role.upper().replace("-", "_") for role in roles}
    if "SUPER_ADMIN" in normalized:
        return "SUPER_ADMIN"
    if "ADMIN" in normalized:
        return "ADMIN"
    return "USER"


def _keycloak_user_name(user: dict) -> str:
    full_name = " ".join(
        str(user.get(part) or "").strip()
        for part in ("firstName", "lastName")
        if str(user.get(part) or "").strip()
    ).strip()
    return full_name or str(user.get("username") or user.get("email") or "")


def _primary_role_name(role_names: list[str]) -> str:
    normalized = {role.upper().replace("-", "_"): role for role in role_names}
    for role in ("SUPER_ADMIN", "ADMIN"):
        if role in normalized:
            return normalized[role]
    for role in role_names:
        normalized_role = role.upper().replace("-", "_")
        if (
            not role.startswith("default-roles-")
            and role not in {"offline_access", "uma_authorization"}
            and normalized_role not in {"USER", "ADMIN", "SUPER_ADMIN"}
        ):
            return role
    if "USER" in normalized:
        return normalized["USER"]
    return "USER"


def _keycloak_user_row(user: dict, roles: list[dict], groups: list[dict] | None = None) -> dict:
    role_names = [str(role.get("name")) for role in roles if role.get("name")]
    primary_role = _primary_role_name(role_names)
    primary_role_data = next((role for role in roles if str(role.get("name") or "") == primary_role), {})
    role_attrs = primary_role_data.get("attributes") or {}
    role_defaults = ROLE_DEFAULTS.get(primary_role, {})
    attrs = _user_attrs(user)
    team_id = _attr_value(attrs, "ewms.teamId", "")
    if not team_id and groups:
        team_id = str((groups[0] or {}).get("id") or "")
    role_levels = _attr_values(role_attrs, "ewms.levels") or list(role_defaults.get("allowedLevels", []))
    level = _attr_value(
        attrs,
        "ewms.level",
        sorted(role_levels or ["L1"], key=lambda item: int(str(item).replace("L", "") or "1"))[-1],
    )
    role_data_scope = _normalize_data_scope(_attr_value(role_attrs, "ewms.dataScope", str(role_defaults.get("defaultDataScope") or "TEAM")))
    data_scope = _normalize_data_scope(_attr_value(attrs, "ewms.dataScope", role_data_scope))
    role_category = _attr_value(role_attrs, "ewms.category", _role_category(primary_role))
    full_name = _keycloak_user_name(user)
    return {
        "id": str(user.get("id") or ""),
        "orgId": _attr_value(attrs, "ewms.orgId", "default-org"),
        "roleId": primary_role,
        "email": str(user.get("email") or user.get("username") or ""),
        "fullName": full_name,
        "userType": _attr_value(attrs, "ewms.userType", "external" if role_category in {"org_external", "external"} else "internal"),
        "status": "active" if user.get("enabled", False) else "inactive",
        "phone": _attr_value(attrs, "phone", ""),
        "level": level,
        "teamId": team_id,
        "dataScope": data_scope,
        "geographyOrigin": _attr_value(attrs, "ewms.geographyOrigin", ""),
        "geographyDestination": _attr_value(attrs, "ewms.geographyDestination", ""),
        "approvalLimitInr": float(_attr_value(attrs, "ewms.approvalLimitInr", "0") or 0) or None,
        "approvalLimitUsd": float(_attr_value(attrs, "ewms.approvalLimitUsd", "0") or 0) or None,
        "createdAt": datetime.fromtimestamp((int(user.get("createdTimestamp") or 0) / 1000), timezone.utc).isoformat() if user.get("createdTimestamp") else None,
        "lastLoginAt": None,
        "keycloakRoles": role_names,
        "role": {
            "id": primary_role,
            "name": _attr_value(role_attrs, "ewms.displayName", str(role_defaults.get("name") or _display_role_name(primary_role))),
            "roleCategory": role_category,
        },
    }


async def _sync_local_user_from_keycloak(*, prisma, keycloak_user: dict, roles: list[dict]):
    email = str(keycloak_user.get("email") or keycloak_user.get("username") or "").strip().lower()
    if not email:
        return None

    name = _keycloak_user_name(keycloak_user)
    role_names = [str(role.get("name")) for role in roles if role.get("name")]
    local_role = _local_role_from_keycloak_roles(role_names, email)
    existing = await prisma.user.find_unique(where={"email": email})
    if existing:
        user = await prisma.user.update(
            where={"id": existing.id},
            data={
                "name": name or email,
                "role": local_role,
                "isActive": bool(keycloak_user.get("enabled", True)),
            },
        )
    else:
        user = await prisma.user.create(
            data={
                "name": name or email,
                "email": email,
                "passwordHash": f"keycloak:{keycloak_user.get('id') or email}",
                "role": local_role,
                "isActive": bool(keycloak_user.get("enabled", True)),
            }
        )

    first_name = str(keycloak_user.get("firstName") or "").strip() or None
    last_name = str(keycloak_user.get("lastName") or "").strip() or None
    if first_name or last_name:
        await prisma.profile.upsert(
            where={"userId": user.id},
            data={
                "update": {
                    "firstName": first_name,
                    "lastName": last_name,
                },
                "create": {
                    "user": {"connect": {"id": user.id}},
                    "firstName": first_name,
                    "lastName": last_name,
                },
            },
        )
    return user


def _user_row(user) -> dict:
    profile = getattr(user, "profile", None)
    name = getattr(user, "name", "") or ""
    if profile:
        profile_name = " ".join(
            part
            for part in [
                getattr(profile, "firstName", None),
                getattr(profile, "lastName", None),
            ]
            if part
        ).strip()
        name = profile_name or name

    role_definition = _role_definition(getattr(user, "role", "USER"))
    return {
        "id": str(user.id),
        "email": str(user.email),
        "fullName": name or str(user.email),
        "status": "active" if getattr(user, "isActive", False) else "inactive",
        "lastLoginAt": None,
        "role": {
            "id": role_definition["id"],
            "name": role_definition["name"],
            "roleCategory": role_definition["roleCategory"],
        },
    }


def _guess_content_type(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".png"}:
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".txt":
        return "text/plain"
    return None


@router.get("/users")
@legacy_router.get("/users")
async def list_admin_users(_user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        prisma = await get_prisma()
    except Exception:
        prisma = None
    try:
        users = keycloak_admin.get_users({})
        rows = []
        for keycloak_user in users:
            keycloak_user = keycloak_admin.get_user(keycloak_user["id"])
            assigned_roles = keycloak_admin.get_realm_roles_of_user(keycloak_user["id"])
            roles = [
                keycloak_admin.get_realm_role(str(role["name"]))
                for role in assigned_roles
                if role.get("name")
            ]
            groups = keycloak_admin.get_user_groups(keycloak_user["id"])
            if prisma is not None:
                await _sync_local_user_from_keycloak(
                    prisma=prisma,
                    keycloak_user=keycloak_user,
                    roles=roles,
                )
            rows.append(_keycloak_user_row(keycloak_user, roles, groups))
        rows.sort(key=lambda item: item["email"].lower())
        return {"ok": True, "data": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync users from Keycloak: {exc}")


def _split_full_name(full_name: str) -> tuple[str, str]:
    first_name, _, last_name = full_name.strip().partition(" ")
    return first_name or full_name.strip(), last_name


def _assign_primary_role(keycloak_admin, user_id: str, role_name: str) -> None:
    selected_role = keycloak_admin.get_realm_role(role_name)
    existing_roles = keycloak_admin.get_realm_roles_of_user(user_id)
    removable = [
        role
        for role in existing_roles
        if role.get("name")
        and not str(role["name"]).startswith("default-roles-")
        and str(role["name"]) not in {"offline_access", "uma_authorization"}
        and str(role["name"]) != role_name
    ]
    if removable:
        keycloak_admin.delete_realm_roles_of_user(user_id, removable)
    existing_role_names = {str(role.get("name")) for role in keycloak_admin.get_realm_roles_of_user(user_id)}
    if role_name not in existing_role_names:
        keycloak_admin.assign_realm_roles(user_id, [selected_role])


def _sync_user_team(keycloak_admin, user_id: str, team_id: str | None) -> None:
    current_groups = keycloak_admin.get_user_groups(user_id)
    for group in current_groups or []:
        attrs = group.get("attributes") or {}
        if _attr_value(attrs, "ewms.kind") == "team":
            if str(group.get("id")) != str(team_id or ""):
                keycloak_admin.group_user_remove(user_id, group["id"])
    if team_id:
        keycloak_admin.group_user_add(user_id, team_id)


async def _sync_keycloak_user_to_local(prisma, keycloak_admin, user_id: str):
    keycloak_user = keycloak_admin.get_user(user_id)
    roles = keycloak_admin.get_realm_roles_of_user(user_id)
    return await _sync_local_user_from_keycloak(
        prisma=prisma,
        keycloak_user=keycloak_user,
        roles=roles,
    )


@router.post("/users")
@legacy_router.post("/users")
async def create_admin_user(request: AdminUserRequest, _user=Depends(get_admin_user)):
    email = str(request.email or "").strip().lower()
    full_name = str(request.fullName or "").strip()
    role_name = str(request.roleId or "").strip()
    if not email or not full_name or not role_name:
        return {"ok": False, "error": "Email, full name, and role are required."}
    keycloak_admin = get_keycloak_admin()
    prisma = await get_prisma()
    first_name, last_name = _split_full_name(full_name)
    try:
        user_id = keycloak_admin.get_user_id(email)
        payload = {
            "username": email,
            "email": email,
            "firstName": first_name,
            "lastName": last_name,
            "enabled": request.status != "inactive",
            "emailVerified": True,
            "attributes": _user_attributes_from_request(request),
        }
        if user_id:
            keycloak_admin.update_user(user_id, payload)
        else:
            user_id = keycloak_admin.create_user(
                {
                    **payload,
                    "credentials": [
                        {
                            "type": "password",
                            "value": request.password or "ChangeMe123!",
                            "temporary": False,
                        }
                    ],
                },
                exist_ok=True,
            )
        if request.password:
            keycloak_admin.set_user_password(user_id, request.password, temporary=False)
        _assign_primary_role(keycloak_admin, user_id, role_name)
        _sync_user_team(keycloak_admin, user_id, request.teamId)
        await _sync_keycloak_user_to_local(prisma, keycloak_admin, user_id)
        user = keycloak_admin.get_user(user_id)
        roles = [
            keycloak_admin.get_realm_role(str(role["name"]))
            for role in keycloak_admin.get_realm_roles_of_user(user_id)
            if role.get("name")
        ]
        groups = keycloak_admin.get_user_groups(user_id)
        return {"ok": True, "data": _keycloak_user_row(user, roles, groups)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create Keycloak user: {exc}")


@router.put("/users/{user_id}")
@legacy_router.put("/users/{user_id}")
async def update_admin_user(user_id: str, request: AdminUserRequest, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    prisma = await get_prisma()
    try:
        existing = keycloak_admin.get_user(user_id)
        full_name = str(request.fullName or _keycloak_user_name(existing)).strip()
        first_name, last_name = _split_full_name(full_name)
        enabled = existing.get("enabled", True)
        if request.status:
            enabled = request.status == "active"
        payload = {
            "email": existing.get("email") or existing.get("username"),
            "username": existing.get("username") or existing.get("email"),
            "firstName": first_name,
            "lastName": last_name,
            "enabled": enabled,
            "emailVerified": True,
            "attributes": _user_attributes_from_request(request, existing),
        }
        keycloak_admin.update_user(user_id, payload)
        if request.password:
            keycloak_admin.set_user_password(user_id, request.password, temporary=False)
        if request.roleId:
            _assign_primary_role(keycloak_admin, user_id, request.roleId)
        if request.teamId is not None:
            _sync_user_team(keycloak_admin, user_id, request.teamId)
        await _sync_keycloak_user_to_local(prisma, keycloak_admin, user_id)
        user = keycloak_admin.get_user(user_id)
        roles = [
            keycloak_admin.get_realm_role(str(role["name"]))
            for role in keycloak_admin.get_realm_roles_of_user(user_id)
            if role.get("name")
        ]
        groups = keycloak_admin.get_user_groups(user_id)
        return {"ok": True, "data": _keycloak_user_row(user, roles, groups)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update Keycloak user: {exc}")


@router.patch("/users/{user_id}/deactivate")
@legacy_router.patch("/users/{user_id}/deactivate")
async def deactivate_admin_user(user_id: str, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    prisma = await get_prisma()
    try:
        existing = keycloak_admin.get_user(user_id)
        keycloak_admin.update_user(user_id, {**existing, "enabled": False})
        await _sync_keycloak_user_to_local(prisma, keycloak_admin, user_id)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not deactivate Keycloak user: {exc}")


@router.get("/roles")
@legacy_router.get("/roles")
async def list_admin_roles(_user=Depends(get_admin_user)):
    try:
        keycloak_admin = get_keycloak_admin()
        roles = keycloak_admin.get_realm_roles()
        users = keycloak_admin.get_users({})
        role_counts: dict[str, int] = {}
        for user in users:
            for role in keycloak_admin.get_realm_roles_of_user(user["id"]):
                name = str(role.get("name") or "")
                role_counts[name] = role_counts.get(name, 0) + 1
        filtered_roles = [
            role for role in roles
            if role.get("name") and not str(role["name"]).startswith("default-roles-")
            and str(role["name"]) not in {"offline_access", "uma_authorization"}
        ]
        return {
            "ok": True,
            "data": [
                _role_profile_from_keycloak(role, user_count=role_counts.get(str(role["name"]), 0))
                for role in sorted(filtered_roles, key=lambda item: str(item.get("name", "")).lower())
            ],
        }
    except Exception as exc:
        return {
            "ok": True,
            "data": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "roleCategory": item["roleCategory"],
                    "isSystemDefault": True,
                    "color": "#0f766e",
                    "allowedLevels": [],
                    "defaultModules": item["modules"],
                    "defaultDataScope": "org",
                }
                for item in ROLE_DEFINITIONS
            ],
            "warning": f"Could not sync roles from Keycloak: {exc}",
        }


@router.get("/roles/{role_id}")
@legacy_router.get("/roles/{role_id}")
async def get_admin_role(role_id: str, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        role = keycloak_admin.get_realm_role(role_id)
        users = keycloak_admin.get_realm_role_members(role_id)
        return {"ok": True, "data": _role_profile_from_keycloak(role, user_count=len(users or []), detail=True)}
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Role not found in Keycloak: {exc}")


@router.post("/roles")
@legacy_router.post("/roles")
async def create_admin_role(request: RoleProfileRequest, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    payload = _role_payload_from_request(request)
    if not payload["attributes"]["ewms.modules"]:
        return {"ok": False, "error": "Select at least one module for this role."}
    try:
        keycloak_admin.create_realm_role(payload, skip_exists=False)
        role = keycloak_admin.get_realm_role(payload["name"])
        return {"ok": True, "data": _role_profile_from_keycloak(role, detail=True)}
    except Exception as exc:
        return {"ok": False, "error": f"Could not create Keycloak role: {exc}"}


@router.put("/roles/{role_id}")
@legacy_router.put("/roles/{role_id}")
async def update_admin_role(role_id: str, request: RoleProfileRequest, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        existing = keycloak_admin.get_realm_role(role_id)
        if role_id in ROLE_DEFAULTS:
            payload = _role_payload_from_request(request, role_id=role_id)
            payload["name"] = role_id
        else:
            payload = _role_payload_from_request(request, role_id=role_id)
        if not payload["attributes"]["ewms.modules"]:
            return {"ok": False, "error": "Select at least one module for this role."}
        payload["id"] = existing.get("id")
        keycloak_admin.update_realm_role(role_id, payload)
        role = keycloak_admin.get_realm_role(role_id)
        return {"ok": True, "data": _role_profile_from_keycloak(role, detail=True)}
    except Exception as exc:
        return {"ok": False, "error": f"Could not update Keycloak role: {exc}"}


@router.delete("/roles/{role_id}")
@legacy_router.delete("/roles/{role_id}")
async def delete_admin_role(role_id: str, _user=Depends(get_admin_user)):
    if role_id in ROLE_DEFAULTS or role_id.lower() in {"admin", "user"}:
        return {"ok": False, "error": "System roles cannot be deleted."}
    keycloak_admin = get_keycloak_admin()
    try:
        users = keycloak_admin.get_realm_role_members(role_id)
        if users:
            return {"ok": False, "error": "Role has users assigned. Reassign them before deleting."}
        keycloak_admin.delete_realm_role(role_id)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": f"Could not delete Keycloak role: {exc}"}


@router.post("/users/invite")
@legacy_router.post("/users/invite")
async def invite_admin_user(request: InviteUserRequest, admin_user=Depends(get_admin_user)):
    email = request.email.strip().lower()
    full_name = request.fullName.strip()
    if not email or not full_name:
        return {"ok": False, "error": "Email and full name are required."}

    prisma = await get_prisma()
    keycloak_admin = get_keycloak_admin()

    first_name, _, last_name = full_name.partition(" ")
    role_name = request.roleId.strip()
    if not role_name:
        return {"ok": False, "error": "Role is required."}

    try:
        role = keycloak_admin.get_realm_role(role_name)
    except Exception:
        local_role = _role_from_request(role_name)
        try:
            role = keycloak_admin.get_realm_role(local_role)
            role_name = local_role
        except Exception:
            return {"ok": False, "error": f"Role not found in Keycloak: {request.roleId}"}

    try:
        user_id = keycloak_admin.get_user_id(email)
        payload = {
            "username": email,
            "email": email,
            "firstName": first_name or full_name,
            "lastName": last_name or "",
            "enabled": True,
            "emailVerified": True,
        }
        if user_id:
            keycloak_admin.update_user(user_id, payload)
        else:
            user_id = keycloak_admin.create_user(
                {
                    **payload,
                    "credentials": [
                        {
                            "type": "password",
                            "value": request.password or "ChangeMe123!",
                            "temporary": False,
                        }
                    ],
                },
                exist_ok=True,
            )
        if request.password:
            keycloak_admin.set_user_password(user_id, request.password, temporary=False)

        existing_roles = keycloak_admin.get_realm_roles_of_user(user_id)
        existing_role_names = {str(existing_role.get("name")) for existing_role in existing_roles}
        if role_name not in existing_role_names:
            keycloak_admin.assign_realm_roles(user_id, [role])

        keycloak_user = {
            "id": user_id,
            **payload,
        }
        synced_user = await _sync_local_user_from_keycloak(
            prisma=prisma,
            keycloak_user=keycloak_user,
            roles=keycloak_admin.get_realm_roles_of_user(user_id),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync user with Keycloak: {exc}")

    local_role = getattr(synced_user, "role", "USER") if synced_user else "USER"
    if _role_from_request(_role_value(local_role)) in {"ADMIN", "SUPER_ADMIN"} and synced_user:
        try:
            buckets = list_buckets()
        except Exception:
            buckets = []

        for bucket in buckets:
            existing_policy = await prisma.s3userpolicy.find_first(
                where={"userId": synced_user.id, "bucket": bucket}
            )
            if existing_policy:
                await prisma.s3userpolicy.update(
                    where={"id": existing_policy.id},
                    data={"permission": "ADMIN", "grantedBy": admin_user.id},
                )
            else:
                await prisma.s3userpolicy.create(
                    data={
                        "userId": synced_user.id,
                        "bucket": bucket,
                        "permission": "ADMIN",
                        "grantedBy": admin_user.id,
                    }
                )

    return {
        "ok": True,
        "data": _keycloak_user_row(
            {"id": user_id, "email": email, "username": email, "firstName": first_name, "lastName": last_name, "enabled": True},
            keycloak_admin.get_realm_roles_of_user(user_id),
        ),
    }


async def _delete_document_with_related_and_storage(*, prisma, document_id: str) -> DeleteDocumentResponse:
    document = await prisma.document.find_unique(
        where={"id": document_id},
        include={"pages": True},
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    object_refs: list[tuple[str, str]] = []
    object_refs.append((str(document.bucket), str(document.objectKey)))
    for page in document.pages:
        object_refs.append((str(page.bucket), str(page.objectKey)))

    await prisma.document.delete(where={"id": document_id})

    storage_delete_errors: list[str] = []
    deleted_keys: list[str] = []
    for bucket, key in object_refs:
        try:
            delete_document_object(bucket, key)
            deleted_keys.append(key)
        except Exception as exc:
            storage_delete_errors.append(f"{bucket}/{key}: {exc}")

    return DeleteDocumentResponse(
        status="success",
        message="Document and related records deleted",
        documentId=document_id,
        deletedObjectKeys=deleted_keys,
        storageDeleteErrors=storage_delete_errors,
    )


@router.get("/storage/buckets", response_model=BucketListResponse)
async def get_storage_buckets(_user=Depends(get_admin_user)):
    try:
        return BucketListResponse(buckets=list_buckets())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list buckets: {exc}")


@router.get("/storage", response_model=StorageListingResponse)
async def get_storage_listing(
    bucket: str = Query(...),
    prefix: str = Query(""),
    _user=Depends(get_admin_user),
):
    try:
        folders, files = list_prefix(bucket=bucket, prefix=prefix)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list storage objects: {exc}")

    normalized_prefix = prefix.strip("/")
    breadcrumbs = [part for part in normalized_prefix.split("/") if part]

    return StorageListingResponse(
        bucket=bucket,
        prefix=normalized_prefix,
        breadcrumbs=breadcrumbs,
        folders=sorted(folders),
        files=[
            StorageFileItem(
                key=str(item["key"]),
                name=str(item["name"]),
                sizeBytes=int(item["sizeBytes"]),
                lastModified=(
                    item["lastModified"].isoformat()
                    if isinstance(item.get("lastModified"), datetime)
                    else None
                ),
                downloadUrl=get_download_url(bucket, str(item["key"])),
                previewUrl=get_download_url(bucket, str(item["key"])),
                contentType=_guess_content_type(str(item["name"])),
            )
            for item in files
        ],
    )


@router.delete("/storage/file")
async def delete_storage_file(request: DeleteFileRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()

    page = await prisma.documentpage.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if page:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(page.documentId),
        )

    document = await prisma.document.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if document:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(document.id),
        )

    try:
        delete_document_object(request.bucket, request.key)
        return {"status": "success", "message": "Storage object deleted (no DB document mapping found)"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete storage object: {exc}")


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
async def delete_document(document_id: str, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    return await _delete_document_with_related_and_storage(
        prisma=prisma,
        document_id=document_id,
    )

# =================================================================
# Keycloak Multi-Tenant Admin Integration
# =================================================================

from keycloak import KeycloakAdmin
from helpers.config import settings

def get_keycloak_admin():
    """Get Keycloak admin client with proper configuration"""
    return KeycloakAdmin(
        server_url=settings.KEYCLOAK_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True
    )

# Keycloak Models
class KeycloakUserCreate(BaseModel):
    username: str
    email: str
    firstName: str
    lastName: str
    password: str
    roles: list[str] = []

class KeycloakUserUpdate(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    enabled: Optional[bool] = None

class KeycloakUserResponse(BaseModel):
    id: str
    username: str
    email: str
    firstName: str
    lastName: str
    enabled: bool
    createdTimestamp: int
    roles: list[str]

class KeycloakRoleCreate(BaseModel):
    name: str
    description: Optional[str] = None

class KeycloakRoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    composite: bool
    clientRole: bool
    containerId: str

class TenantRealmCreate(BaseModel):
    tenant_id: str
    realm_name: str
    display_name: str
    admin_email: str
    admin_password: str

class TenantSwitchRequest(BaseModel):
    current_tenant_id: str
    new_tenant_id: str

# =================================================================
# Multi-Tenant Realm Management
# =================================================================

@router.post("/tenants/realms")
async def create_tenant_realm(
    tenant_data: TenantRealmCreate,
    _user=Depends(get_admin_user)
):
    """Create a new realm for a tenant"""
    keycloak_admin = get_keycloak_admin()

    # Create the realm
    realm_payload = {
        "realm": tenant_data.realm_name,
        "enabled": True,
        "displayName": tenant_data.display_name,
        "registrationAllowed": False,
        "editUsernameAllowed": True
    }

    try:
        keycloak_admin.create_realm(realm_payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create realm: {str(e)}")

    # Create admin client for the realm
    client_payload = {
        "clientId": "admin-client",
        "protocol": "openid-connect",
        "publicClient": False,
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": True,
        "serviceAccountsEnabled": True
    }

    keycloak_admin.create_client(
        realm_name=tenant_data.realm_name,
        payload=client_payload
    )

    # Create initial admin user
    admin_user = keycloak_admin.create_user(
        realm_name=tenant_data.realm_name,
        payload={
            "username": "admin",
            "email": tenant_data.admin_email,
            "firstName": "Tenant",
            "lastName": "Admin",
            "enabled": True,
            "credentials": [{
                "type": "password",
                "value": tenant_data.admin_password,
                "temporary": False
            }]
        }
    )

    # Create initial roles
    initial_roles = ["admin", "manager", "user", "viewer"]
    for role_name in initial_roles:
        keycloak_admin.create_realm_role(
            realm_name=tenant_data.realm_name,
            payload={"name": role_name}
        )

    # Assign admin role to admin user
    admin_roles = keycloak_admin.get_realm_roles(realm_name=tenant_data.realm_name)
    admin_role = next(r for r in admin_roles if r["name"] == "admin")
    keycloak_admin.assign_realm_roles(
        user_id=admin_user,
        roles=[admin_role],
        realm_name=tenant_data.realm_name
    )

    return {
        "status": "success",
        "realm": tenant_data.realm_name,
        "admin_email": tenant_data.admin_email,
        "message": "Tenant realm created successfully"
    }

@router.post("/switch-tenant")
async def switch_tenant(
    request: TenantSwitchRequest,
    current_user=Depends(get_current_user)
):
    """Handle tenant switching for admin users"""
    # Verify current user has permission to switch tenants
    if current_user.role != "global-admin":
        raise HTTPException(status_code=403, detail="Only global admins can switch tenants")

    # Verify both tenants exist
    keycloak_admin = get_keycloak_admin()
    current_realm = f"tenant-{request.current_tenant_id}"
    new_realm = f"tenant-{request.new_tenant_id}"

    try:
        keycloak_admin.get_realm(current_realm)
        keycloak_admin.get_realm(new_realm)
    except Exception:
        raise HTTPException(status_code=404, detail="One or both tenant realms not found")

    # For now, just return success
    # In production, you would generate a tenant-switch token
    return {
        "status": "success",
        "new_tenant_id": request.new_tenant_id,
        "message": "Tenant switch initiated"
    }

# =================================================================
# Tenant-Specific User Management
# =================================================================

@router.get("/tenants/{tenant_id}/users")
async def list_tenant_users(
    tenant_id: str,
    _user=Depends(get_admin_user)
):
    """List users in a specific tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        users = keycloak_admin.get_users(realm_name=realm_name)

        # Enrich with role information
        enriched_users = []
        for user in users:
            user_roles = keycloak_admin.get_user_realm_roles(
                user_id=user['id'],
                realm_name=realm_name
            )
            enriched_users.append({
                **user,
                "roles": user_roles,
                "tenant_id": tenant_id
            })

        return enriched_users
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Tenant realm not found: {str(e)}")

@router.post("/tenants/{tenant_id}/users")
async def create_tenant_user(
    tenant_id: str,
    user_data: KeycloakUserCreate,
    _user=Depends(get_admin_user)
):
    """Create a new user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Create user
    user_id = keycloak_admin.create_user(
        realm_name=realm_name,
        payload={
            "username": user_data.username,
            "email": user_data.email,
            "firstName": user_data.firstName,
            "lastName": user_data.lastName,
            "enabled": True,
            "credentials": [{
                "type": "password",
                "value": user_data.password,
                "temporary": False
            }]
        }
    )

    # Assign roles
    if user_data.roles:
        realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
        roles_to_assign = [role for role in realm_roles if role['name'] in user_data.roles]
        if roles_to_assign:
            keycloak_admin.assign_realm_roles(
                user_id=user_id,
                roles=roles_to_assign,
                realm_name=realm_name
            )

    # Get created user with roles
    created_user = keycloak_admin.get_user(user_id, realm_name=realm_name)
    user_roles = keycloak_admin.get_user_realm_roles(user_id, realm_name=realm_name)

    return {
        **created_user,
        "roles": user_roles,
        "tenant_id": tenant_id
    }

# =================================================================
# Tenant-Specific Role Management
# =================================================================

@router.get("/tenants/{tenant_id}/roles")
async def list_tenant_roles(
    tenant_id: str,
    _user=Depends(get_admin_user)
):
    """List all roles in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
        return roles
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Tenant realm not found: {str(e)}")

@router.post("/tenants/{tenant_id}/roles")
async def create_tenant_role(
    tenant_id: str,
    role_data: KeycloakRoleCreate,
    _user=Depends(get_admin_user)
):
    """Create a custom role in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        role = keycloak_admin.create_realm_role(
            realm_name=realm_name,
            payload={
                "name": role_data.name,
                "description": role_data.description
            }
        )
        return role
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create role: {str(e)}")

@router.post("/tenants/{tenant_id}/users/{user_id}/roles")
async def assign_roles_to_user(
    tenant_id: str,
    user_id: str,
    role_names: list[str],
    _user=Depends(get_admin_user)
):
    """Assign roles to a user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Get available roles
    realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
    roles_to_assign = [role for role in realm_roles if role['name'] in role_names]

    if not roles_to_assign:
        raise HTTPException(status_code=404, detail="No valid roles found")

    keycloak_admin.assign_realm_roles(
        user_id=user_id,
        roles=roles_to_assign,
        realm_name=realm_name
    )

    return {
        "status": "success",
        "message": f"Assigned {len(roles_to_assign)} roles to user {user_id}",
        "assigned_roles": [role['name'] for role in roles_to_assign]
    }

@router.delete("/tenants/{tenant_id}/users/{user_id}/roles/{role_name}")
async def remove_role_from_user(
    tenant_id: str,
    user_id: str,
    role_name: str,
    _user=Depends(get_admin_user)
):
    """Remove a role from a user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Get the role
    realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
    role = next((r for r in realm_roles if r['name'] == role_name), None)

    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    keycloak_admin.remove_realm_roles(
        user_id=user_id,
        roles=[role],
        realm_name=realm_name
    )

    return {
        "status": "success",
        "message": f"Removed role {role_name} from user {user_id}"
    }
