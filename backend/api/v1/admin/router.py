import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

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
legacy_router = APIRouter(prefix=settings.API_SLUG + "/admin", tags=["Admin"])


ROLE_DEFINITIONS = [
    {
        "id": "Super Admin",
        "name": "Super Admin",
        "systemCode": "super_admin",
        "roleCategory": "INTERNAL_OPS",
        "modules": ["dashboard", "shipments", "tasks", "documents", "inventory", "accounting", "reports", "admin"],
    },
    {
        "id": "Org Admin",
        "name": "Org Admin",
        "systemCode": "org_admin",
        "roleCategory": "INTERNAL_OPS",
        "modules": ["dashboard", "shipments", "tasks", "documents", "inventory", "accounting", "reports", "admin"],
    },
    {
        "id": "Ops Manager",
        "name": "Ops Manager",
        "systemCode": "ops_manager",
        "roleCategory": "INTERNAL_OPS",
        "modules": ["dashboard", "shipments", "tasks", "documents", "inventory", "accounting", "reports", "admin"],
    },
    {
        "id": "India Logistics",
        "name": "India Logistics",
        "systemCode": "india_logistics",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "shipments", "tasks", "documents", "inventory"],
    },
    {
        "id": "US Logistics",
        "name": "US Logistics",
        "systemCode": "us_logistics",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "shipments", "tasks", "documents", "inventory"],
    },
    {
        "id": "Finance AP India",
        "name": "Finance AP India",
        "systemCode": "finance_ap_india",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "accounting", "documents", "reports"],
    },
    {
        "id": "Finance AP US",
        "name": "Finance AP US",
        "systemCode": "finance_ap_us",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "accounting", "documents", "reports"],
    },
    {
        "id": "Finance Revenue",
        "name": "Finance Revenue",
        "systemCode": "finance_revenue",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "accounting", "documents", "reports"],
    },
    {
        "id": "Finance Controller",
        "name": "Finance Controller",
        "systemCode": "finance_controller",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "accounting", "documents", "reports", "admin"],
    },
    {
        "id": "Auditor",
        "name": "Auditor",
        "systemCode": "auditor",
        "roleCategory": "INTERNAL_SPECIALIST",
        "modules": ["dashboard", "shipments", "documents", "reports"],
    },
    {
        "id": "CHA Partner",
        "name": "CHA Partner",
        "systemCode": "cha_partner",
        "roleCategory": "EXTERNAL_PARTNER",
        "modules": ["shipments", "documents", "tasks"],
    },
    {
        "id": "Freight Forwarder",
        "name": "Freight Forwarder",
        "systemCode": "freight_forwarder",
        "roleCategory": "EXTERNAL_PARTNER",
        "modules": ["shipments", "documents", "tasks"],
    },
    {
        "id": "US Broker",
        "name": "US Broker",
        "systemCode": "us_broker",
        "roleCategory": "EXTERNAL_PARTNER",
        "modules": ["shipments", "documents", "tasks"],
    },
    {
        "id": "3PL Partner",
        "name": "3PL Partner",
        "systemCode": "tpl_partner",
        "roleCategory": "EXTERNAL_PARTNER",
        "modules": ["shipments", "documents", "inventory", "tasks"],
    },
    {
        "id": "Customer Portal",
        "name": "Customer Portal",
        "systemCode": "customer_portal",
        "roleCategory": "CUSTOMER",
        "modules": ["portal"],
    },
]

ROLE_ALIASES = {
    "role-org-admin": "Org Admin",
    "role-admin": "Org Admin",
    "admin": "Org Admin",
    "org_admin": "Org Admin",
    "org-admin": "Org Admin",
    "org admin": "Org Admin",
    "super_admin": "Super Admin",
    "super-admin": "Super Admin",
    "super admin": "Super Admin",
    "role-super-admin": "Super Admin",
    "ops_manager": "Ops Manager",
    "ops-manager": "Ops Manager",
    "ops manager": "Ops Manager",
    "india_logistics": "India Logistics",
    "india-logistics": "India Logistics",
    "india logistics": "India Logistics",
    "us_logistics": "US Logistics",
    "us-logistics": "US Logistics",
    "us logistics": "US Logistics",
    "finance_ap_india": "Finance AP India",
    "finance-ap-india": "Finance AP India",
    "finance ap india": "Finance AP India",
    "finance_ap_us": "Finance AP US",
    "finance-ap-us": "Finance AP US",
    "finance ap us": "Finance AP US",
    "finance_revenue": "Finance Revenue",
    "finance-revenue": "Finance Revenue",
    "finance revenue": "Finance Revenue",
    "finance_controller": "Finance Controller",
    "finance-controller": "Finance Controller",
    "finance controller": "Finance Controller",
    "auditor": "Auditor",
    "cha_partner": "CHA Partner",
    "cha-partner": "CHA Partner",
    "cha partner": "CHA Partner",
    "freight_forwarder": "Freight Forwarder",
    "freight-forwarder": "Freight Forwarder",
    "freight forwarder": "Freight Forwarder",
    "us_broker": "US Broker",
    "us-broker": "US Broker",
    "us broker": "US Broker",
    "tpl_partner": "3PL Partner",
    "tpl-partner": "3PL Partner",
    "3pl partner": "3PL Partner",
    "customer_portal": "Customer Portal",
    "customer-portal": "Customer Portal",
    "customer portal": "Customer Portal",
    "role-viewer": "Auditor",
    "role-user": "India Logistics",
    "viewer": "Auditor",
    "user": "India Logistics",
    "three_pl_partner": "3PL Partner",
}

DEFAULT_KEYCLOAK_ROLE_NAMES = {
    "Super Admin": "SUPER_ADMIN",
    "Org Admin": "ADMIN",
    "Ops Manager": "OPS_MANAGER",
    "India Logistics": "INDIA_LOGISTICS",
    "US Logistics": "US_LOGISTICS",
    "Finance AP India": "FINANCE_AP_INDIA",
    "Finance AP US": "FINANCE_AP_US",
    "Finance Revenue": "FINANCE_REVENUE",
    "Finance Controller": "FINANCE_CONTROLLER",
    "3PL Partner": "THREE_PL_PARTNER",
}

SHEET_ACTIVITY_SETS = {
    "documents_basic": [
        "documents.upload", "documents.classify_document_type", "documents.re_upload_document",
        "documents.reassign_document_to_shipment", "documents.download_export", "documents.view",
        "documents.view_extracted",
    ],
    "documents_approval": [
        "documents.edit_extracted", "documents.submit_for_approval", "documents.approve_draft",
        "documents.reject_extraction", "documents.revoke_approval", "documents.override_approved_fields",
    ],
    "generation": [
        "documents.view_draft", "documents.fill_manual_fields", "documents.modify_generated_fields",
        "documents.save_draft", "documents.submit_for_review", "documents.approve_generated_document",
        "documents.reject_generated_document", "documents.generate_draft", "documents.re_trigger_generation",
        "documents.discard_draft",
    ],
    "validation": [
        "documents.view_validation_results", "documents.resolve_validation_failure",
        "documents.trigger_re_validation", "documents.override_validation",
    ],
    "mapping": [
        "documents.map_container_to_sku", "documents.submit_mapping_for_approval",
        "documents.approve_container_mapping", "documents.reject_container_mapping",
    ],
    "shipments": [
        "shipments.view", "shipments.create", "shipments.export_details", "shipments.hold_shipment",
        "shipments.resume_shipment", "shipments.cancel_shipment", "shipments.change_shipment_type",
    ],
    "inventory": [
        "inventory.view_container", "inventory.inventory_tracking_breakbulk",
        "inventory.create_outward_grn_new_dispatch", "inventory.approve_dispatch",
        "inventory.reject_dispatch", "inventory.view_outward_dispatches",
        "inventory.adjust_stock_without_remarks", "inventory.adjust_stock_with_remarks",
        "inventory.3_way_recon",
    ],
    "warehouse": [
        "inventory.view_warehouse", "inventory.warehouse_inventory_stock_position",
    ],
    "dnd": [
        "dnd.activate", "dnd.activate.start_event_date",
        "dnd.activate.holiday_days", "dnd.activate.weekends",
        "dnd.tariff.create", "dnd.tariff.edit", "dnd.tariff.view",
        "dnd.tariff.force_expire", "dnd.holiday_calendar.upload",
    ],
    "admin": [
        "admin.manage", "users.manage", "roles.view", "roles.manage",
        "admin.manage_users", "admin.configure_roles", "admin.edit_workflows",
        "admin.configure_doctypes", "admin.edit_account_mappings",
        "admin.manage_partners", "admin.view_audit_log", "admin.security_settings",
    ],
}


def _activities_for(*set_names: str) -> list[str]:
    codes: list[str] = []
    for set_name in set_names:
        for code in SHEET_ACTIVITY_SETS.get(set_name, []):
            if code not in codes:
                codes.append(code)
    return codes


ROLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "Super Admin": {
        "name": "Super Admin",
        "description": "Platform-level admin - full access to all modules and data.",
        "roleCategory": "INTERNAL_OPS",
        "color": "#1E293B",
        "allowedLevels": ["L4"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "reports", "admin", "settings"],
        "activityCodes": _activities_for("documents_basic", "documents_approval", "generation", "validation", "mapping", "shipments", "inventory", "dnd", "admin"),
    },
    "Org Admin": {
        "name": "Org Admin",
        "description": "Organisation administration and operations control.",
        "roleCategory": "INTERNAL_OPS",
        "color": "#334155",
        "allowedLevels": ["L4"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "reports", "admin", "settings"],
        "activityCodes": _activities_for("documents_basic", "documents_approval", "generation", "validation", "mapping", "shipments", "inventory", "dnd", "admin"),
    },
    "Ops Manager": {
        "name": "Ops Manager",
        "description": "Operations manager - manages shipments, workflow, documents, and overrides.",
        "roleCategory": "INTERNAL_OPS",
        "color": "#0F766E",
        "allowedLevels": ["L3"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "shipments", "tasks", "documents", "inventory", "warehouse", "dnd", "accounting", "reports", "admin", "settings"],
        "activityCodes": _activities_for("documents_basic", "documents_approval", "generation", "validation", "mapping", "shipments", "inventory", "admin") + [
            "dnd.activate", "dnd.activate.start_event_date", "dnd.activate.holiday_days",
            "dnd.activate.weekends", "dnd.tariff.create", "dnd.tariff.edit",
            "dnd.tariff.view", "dnd.holiday_calendar.upload",
        ],
    },
    "India Logistics": {
        "name": "India Logistics",
        "description": "India-side logistics coordinator - shipments, documents, and inventory.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#0EA5A0",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TEAM",
        "defaultModules": ["dashboard", "shipments", "tasks", "documents", "inventory", "dnd"],
        "activityCodes": _activities_for("documents_basic", "documents_approval", "generation", "validation", "shipments", "inventory") + [
            "dnd.activate", "dnd.activate.start_event_date", "dnd.activate.holiday_days",
            "dnd.activate.weekends", "dnd.tariff.view",
        ],
    },
    "US Logistics": {
        "name": "US Logistics",
        "description": "US-side logistics coordinator - tracking, inventory, and POD.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#0284C7",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TEAM",
        "defaultModules": ["dashboard", "shipments", "tasks", "documents", "inventory", "dnd"],
        "activityCodes": _activities_for("documents_basic", "validation", "shipments", "inventory") + [
            "dnd.activate", "dnd.activate.start_event_date", "dnd.activate.holiday_days",
            "dnd.activate.weekends", "dnd.tariff.view",
        ],
    },
    "Finance AP India": {
        "name": "Finance AP India",
        "description": "Accounts payable India - INR tickets and India vendor bills.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#D97706",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "accounting", "documents", "reports"],
        "activityCodes": _activities_for("documents_basic", "validation"),
    },
    "Finance AP US": {
        "name": "Finance AP US",
        "description": "Accounts payable US - USD tickets, ocean freight, and duties.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#EA580C",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "accounting", "documents", "reports"],
        "activityCodes": _activities_for("documents_basic", "validation"),
    },
    "Finance Revenue": {
        "name": "Finance Revenue",
        "description": "Revenue accounting - sales invoice recognition.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#CA8A04",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "accounting", "documents", "reports"],
        "activityCodes": _activities_for("documents_basic", "generation"),
    },
    "Finance Controller": {
        "name": "Finance Controller",
        "description": "Finance controller - full finance and admin access.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#B45309",
        "allowedLevels": ["L3", "L4"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "accounting", "documents", "reports", "admin"],
        "activityCodes": _activities_for("documents_basic", "documents_approval", "generation", "validation"),
    },
    "Auditor": {
        "name": "Auditor",
        "description": "Read-only access across modules - no write actions.",
        "roleCategory": "INTERNAL_SPECIALIST",
        "color": "#64748B",
        "allowedLevels": ["L2", "L3"],
        "defaultDataScope": "ALL",
        "defaultModules": ["dashboard", "shipments", "documents", "reports"],
        "activityCodes": ["documents.view", "documents.view_extracted", "documents.download_export", "documents.view_validation_results", "shipments.view"],
    },
    "CHA Partner": {
        "name": "CHA Partner",
        "description": "Customs house agent - upload CHA bills and view tagged shipments.",
        "roleCategory": "EXTERNAL_PARTNER",
        "color": "#7C3AED",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TAGGED",
        "defaultModules": ["shipments", "documents", "tasks"],
        "activityCodes": ["shipments.view", "documents.upload", "documents.view"],
    },
    "Freight Forwarder": {
        "name": "Freight Forwarder",
        "description": "Freight forwarder - upload freight bills and BOLs.",
        "roleCategory": "EXTERNAL_PARTNER",
        "color": "#9333EA",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TAGGED",
        "defaultModules": ["shipments", "documents", "tasks"],
        "activityCodes": ["shipments.view", "documents.upload", "documents.view", "documents.view_extracted", "documents.download_export"],
    },
    "US Broker": {
        "name": "US Broker",
        "description": "US customs broker - CBP FORM 7501 and ISF workflows.",
        "roleCategory": "EXTERNAL_PARTNER",
        "color": "#C026D3",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TAGGED",
        "defaultModules": ["shipments", "documents", "tasks"],
        "activityCodes": ["shipments.view", "documents.upload", "documents.view", "documents.view_extracted"],
    },
    "3PL Partner": {
        "name": "3PL Partner",
        "description": "Third-party logistics partner - warehouse, POD, and delivery workflows.",
        "roleCategory": "EXTERNAL_PARTNER",
        "color": "#DB2777",
        "allowedLevels": ["L1", "L2"],
        "defaultDataScope": "TAGGED",
        "defaultModules": ["shipments", "documents", "inventory", "warehouse", "tasks"],
        "activityCodes": ["shipments.view", "documents.upload", "documents.view", "inventory.view_warehouse", "inventory.view_container"],
    },
    "Customer Portal": {
        "name": "Customer Portal",
        "description": "Customer portal user - external shipment visibility.",
        "roleCategory": "CUSTOMER",
        "color": "#059669",
        "allowedLevels": ["L1"],
        "defaultDataScope": "TAGGED",
        "defaultModules": ["portal"],
        "activityCodes": [],
    },
}

ROLE_SYSTEM_CODES = {
    item["id"]: item.get("systemCode")
    for item in ROLE_DEFINITIONS
    if item.get("systemCode")
}

ROLE_PROFILE_CATEGORIES = {
    "INTERNAL_OPS": "operations",
    "INTERNAL_SPECIALIST": "document_controller",
    "EXTERNAL_PARTNER": "partner",
    "CUSTOMER": "customer",
}

REFERENCE_USER_DEFAULTS = {
    "admin@sprconsultech.com": {
        "fullName": "SPR Admin",
        "roleName": "Super Admin",
        "level": "L4",
        "dataScope": "ALL",
        "userType": "internal",
    },
    "ops@zetwerk.com": {
        "fullName": "Manish Agarwal",
        "roleName": "Ops Manager",
        "level": "L4",
        "dataScope": "ALL",
        "userType": "internal",
    },
    "india@zetwerk.com": {
        "fullName": "Priya Logistics",
        "roleName": "India Logistics",
        "level": "L2",
        "dataScope": "TEAM",
        "userType": "internal",
    },
    "us@zetwerk.com": {
        "fullName": "Mike US Logistics",
        "roleName": "US Logistics",
        "level": "L2",
        "dataScope": "TEAM",
        "userType": "internal",
    },
    "finance@zetwerk.com": {
        "fullName": "Ravi Finance",
        "roleName": "Finance AP India",
        "level": "L2",
        "dataScope": "ALL",
        "userType": "internal",
    },
    "3pl@pacific-dist.com": {
        "fullName": "Pacific Distribution - 3PL",
        "roleName": "3PL Partner",
        "level": "L2",
        "dataScope": "TAGGED",
        "userType": "internal",
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
    {"id": "activity-dnd-activate", "activityCode": "dnd.activate", "name": "Activate D&D", "category": "dnd_activate", "displayGroup": "Demurrage and detention", "subModule": "Activate D&D", "moduleCode": "dnd", "minLevel": "L2"},
    {"id": "activity-dnd-activate-start-event-date", "activityCode": "dnd.activate.start_event_date", "name": "Start event date", "category": "dnd_activate", "displayGroup": "Demurrage and detention", "subModule": "Activate D&D", "moduleCode": "dnd", "scope": "Dropdown", "minLevel": "L2"},
    {"id": "activity-dnd-activate-holiday-days", "activityCode": "dnd.activate.holiday_days", "name": "Holiday days", "category": "dnd_activate", "displayGroup": "Demurrage and detention", "subModule": "Activate D&D", "moduleCode": "dnd", "scope": "Checkbox", "minLevel": "L2"},
    {"id": "activity-dnd-activate-weekends", "activityCode": "dnd.activate.weekends", "name": "Weekends", "category": "dnd_activate", "displayGroup": "Demurrage and detention", "subModule": "Activate D&D", "moduleCode": "dnd", "scope": "Checkbox", "minLevel": "L2"},
    {"id": "activity-dnd-tariff-create", "activityCode": "dnd.tariff.create", "name": "Create a Tariff master", "category": "dnd_tariff_master", "displayGroup": "Demurrage and detention", "subModule": "Tariff master", "moduleCode": "dnd", "minLevel": "L3"},
    {"id": "activity-dnd-tariff-edit", "activityCode": "dnd.tariff.edit", "name": "Edit Tariff master", "category": "dnd_tariff_master", "displayGroup": "Demurrage and detention", "subModule": "Tariff master", "moduleCode": "dnd", "minLevel": "L3"},
    {"id": "activity-dnd-tariff-view", "activityCode": "dnd.tariff.view", "name": "View tariff master", "category": "dnd_tariff_master", "displayGroup": "Demurrage and detention", "subModule": "Tariff master", "moduleCode": "dnd", "minLevel": "L1"},
    {"id": "activity-dnd-tariff-force-expire", "activityCode": "dnd.tariff.force_expire", "name": "Force expire Tariff master", "category": "dnd_tariff_master", "displayGroup": "Demurrage and detention", "subModule": "Tariff master", "moduleCode": "dnd", "minLevel": "L4"},
    {"id": "activity-dnd-holiday-calendar-upload", "activityCode": "dnd.holiday_calendar.upload", "name": "Upload Holiday calendar master", "category": "dnd_holiday_calendar", "displayGroup": "Demurrage and detention", "subModule": "Holiday calendar master", "moduleCode": "dnd", "minLevel": "L3"},
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
    {"id": "activity-tasks-update", "activityCode": "tasks.update", "name": "Update tasks", "category": "tasks", "minLevel": "L2"},
    {"id": "activity-tasks-assign", "activityCode": "tasks.assign", "name": "Assign tasks", "category": "tasks", "minLevel": "L3"},
    {"id": "activity-tasks-escalate", "activityCode": "tasks.escalate", "name": "Escalate tasks", "category": "tasks", "minLevel": "L3"},
    {"id": "activity-tasks-delegate", "activityCode": "tasks.delegate", "name": "Delegate tasks", "category": "tasks", "minLevel": "L3"},
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

ACTIVITY_MODULE_OVERRIDES = {
    "inventory.view_warehouse": "warehouse",
    "inventory.warehouse_inventory_stock_position": "warehouse",
    "inventory.acknowledge_dnd": "dnd",
    "inventory.view_dnd_charges": "dnd",
    "inventory.view_last_free_days_shipment_based": "dnd",
    "inventory.view_lfd_calendar": "dnd",
    "inventory.modify_lfd": "dnd",
    "dnd.activate": "dnd",
    "dnd.activate.start_event_date": "dnd",
    "dnd.activate.holiday_days": "dnd",
    "dnd.activate.weekends": "dnd",
    "dnd.tariff.create": "dnd",
    "dnd.tariff.edit": "dnd",
    "dnd.tariff.view": "dnd",
    "dnd.tariff.force_expire": "dnd",
    "dnd.holiday_calendar.upload": "dnd",
}

KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX = 250

SHEET_STATUS_ACTIVITY_ROWS = [
    ("documents", "Document", "documents.upload", "Upload Document", "Doc names", "Uploaded", None),
    ("documents", "Document", "documents.classify_document_type", "Classify Document Type", "Doc names", "(No State Change)", None),
    ("documents", "Document", "documents.reprocess_ocr", "Retry OCR", None, "OCR Processing", None),
    ("documents", "Document", "documents.re_upload_document", "Re-upload Document", "Doc names", "Uploaded (New Version)", None),
    ("documents", "Document", "documents.reassign_document_to_shipment", "Reassign Document to Shipment", "Doc names", "(No State Change)", None),
    ("documents", "Document", "documents.download_export", "Download Document", "Doc names", "(No State Change)", None),
    ("documents", "Document", "documents.delete", "Delete Document", "Doc names", "deleted", None),
    ("documents", "Document", "documents.view", "View Document", "Doc names", "(No State Change)", None),
    ("documents", "OCR & Extraction", "documents.ocr_completed", "OCR Completed (System)", "Doc names", "Extracted", None),
    ("documents", "OCR & Extraction", "documents.view_extracted", "View Extraction", "Doc names", "(No State Change)", None),
    ("documents", "OCR & Extraction", "documents.edit_extracted", "Amend Extracted Fields", "Doc names", "Amended", None),
    ("documents", "OCR & Extraction", "documents.submit_for_approval", "Submit for Approval (if approval enabled)", "Doc names", "Pending Approval", None),
    ("documents", "OCR & Extraction", "documents.approve_draft", "Approve Extraction (if approval disabled OR Supervisor approves)", "Doc names", "Approved", None),
    ("documents", "OCR & Extraction", "documents.reject_extraction", "Reject Extraction", "Doc names", "Rejected", None),
    ("documents", "OCR & Extraction", "documents.revoke_approval", "Revoke Approval", "Doc names", "Under Review", None),
    ("documents", "OCR & Extraction", "documents.override_approved_fields", "Override Approved Fields", "Doc names", "Amended", None),
    ("documents", "Generated Documents", "documents.view_draft", "View Draft", "Doc names", "Draft", None),
    ("documents", "Generated Documents", "documents.fill_manual_fields", "Fill Manual Fields", "Doc names", "Draft", None),
    ("documents", "Generated Documents", "documents.modify_generated_fields", "Modify Generated Fields", "Doc names", "Draft", None),
    ("documents", "Generated Documents", "documents.save_draft", "Save Draft", "Doc names", "Draft", None),
    ("documents", "Generated Documents", "documents.submit_for_review", "Submit for Review", "Doc names", "Pending Approval", None),
    ("documents", "Generated Documents", "documents.approve_generated_document", "Approve Generated Document", "Doc names", "Approved", None),
    ("documents", "Generated Documents", "documents.reject_generated_document", "Reject Generated Document", "Doc names", "Rejected", None),
    ("documents", "Generated Documents", "documents.generate_draft", "Generate PDF (System)", "Doc names", "Generated", None),
    ("documents", "Generated Documents", "documents.re_trigger_generation", "Re-trigger Generation", "Doc names", "Draft", None),
    ("documents", "Generated Documents", "documents.discard_draft", "Discard draft", "Doc names", "Discarded", None),
    ("documents", "Validation", "documents.validation_triggered", "Validation Triggered (System)", "Doc names", "Validation In Progress", None),
    ("documents", "Validation", "documents.view_validation_results", "View Validation Results", "Doc names", "Validated / Validation Warning / Validation Blocked", None),
    ("documents", "Validation", "documents.resolve_validation_failure", "Resolve Validation Failure", "Doc names", "Pending Revalidation", None),
    ("documents", "Validation", "documents.trigger_re_validation", "Trigger Re-validation", "Doc names", "Validation In Progress", None),
    ("documents", "Validation", "documents.override_validation", "Override Validation", "Doc names", "Validated (Override)", None),
    ("documents", "Container Mapping", "documents.map_container_to_sku", "Map Container to SKU", "Doc names", "Mapped", None),
    ("documents", "Container Mapping", "documents.submit_mapping_for_approval", "Submit Mapping for Approval (if applicable)", "Doc names", "Pending Approval", None),
    ("documents", "Container Mapping", "documents.approve_container_mapping", "Approve Container Mapping", "Doc names", "Approved", None),
    ("documents", "Container Mapping", "documents.reject_container_mapping", "Reject Container Mapping", "Doc names", "Rejected", None),
    ("shipments", "Active Templates", "shipments.view", "View Shipment", None, None, None),
    ("shipments", "Active Templates", "shipments.create", "Create Shipment", None, None, None),
    ("shipments", "Active Templates", "shipments.export_details", "Export Shipment details", None, None, None),
    ("shipments", "Active Templates", "shipments.hold_shipment", "Hold Shipment", None, "Hold/ Resume", None),
    ("shipments", "Active Templates", "shipments.resume_shipment", "Resume Shipment", None, None, None),
    ("shipments", "Active Templates", "shipments.cancel_shipment", "Cancel Shipment", None, None, None),
    ("shipments", "Active Templates", "shipments.change_shipment_type", "Change Shipment Type", None, None, None),
    ("inventory", "Inventory", "inventory.view_warehouse", "View Inventory - Warehouse", None, None, None),
    ("inventory", "Inventory", "inventory.view_container", "Inventory tracking   - Container", None, None, None),
    ("inventory", "Inventory", "inventory.inventory_tracking_breakbulk", "Inventory tracking   - Breakbulk", None, None, None),
    ("inventory", "Inventory", "inventory.create_outward_grn_new_dispatch", "Create Outward GRN / New dispatch", "Target Out - DRAFT", "Reserved", "SKU status"),
    ("inventory", "Inventory", "inventory.approve_dispatch", "Approve Dispatch", "Confirmed out", None, None),
    ("inventory", "Inventory", "inventory.reject_dispatch", "Reject Dispatch", "Dispatch rejected", None, None),
    ("inventory", "Inventory", "inventory.view_outward_dispatches", "View outward Dispatches", None, None, None),
    ("inventory", "Inventory", "inventory.adjust_stock_without_remarks", "Adjust Stock - without remarks", None, None, None),
    ("inventory", "Inventory", "inventory.adjust_stock_with_remarks", "Adjust Stock - with remarks", None, None, None),
    ("inventory", "Inventory", "inventory.move_inventory", "Move Inventory", None, None, "Not implemented"),
    ("inventory", "Inventory", "inventory.warehouse_inventory_stock_position", "Warehouse Inventory / stock position", None, None, None),
    ("inventory", "Inventory", "inventory.3_way_recon", "3 way recon", None, None, None),
    ("inventory", "Inventory", "inventory.view_dnd_charges", "View D&D charges", None, None, None),
    ("inventory", "Inventory", "inventory.view_last_free_days_shipment_based", "View Last free days - shipment based", None, None, None),
    ("inventory", "Inventory", "inventory.view_lfd_calendar", "View LFD calendar", None, None, None),
    ("inventory", "Inventory", "inventory.modify_lfd", "Modify LFD", None, None, None),
    ("inventory", "Inventory", "inventory.returned", "Returned", "Returned", None, "Both SKU n GRN"),
    ("inventory", "Inventory", "inventory.delivered", "delivered", "Delivered", None, "Both SKU n GRN"),
]

SHEET_ACTIVITY_MIN_LEVELS = {
    "documents.reject_extraction": "L2",
    "documents.revoke_approval": "L3",
    "documents.override_approved_fields": "L3",
    "documents.view_draft": "L2",
    "documents.fill_manual_fields": "L1",
    "documents.modify_generated_fields": "L2",
    "documents.save_draft": "L1",
    "documents.submit_for_review": "L2",
    "documents.approve_generated_document": "L2",
    "documents.reject_generated_document": "L2",
    "documents.generate_draft": "L2",
    "documents.re_trigger_generation": "L2",
    "documents.discard_draft": "L2",
    "documents.validation_triggered": "L1",
    "documents.view_validation_results": "L1",
    "documents.resolve_validation_failure": "L2",
    "documents.trigger_re_validation": "L2",
    "documents.map_container_to_sku": "L1",
    "documents.submit_mapping_for_approval": "L2",
    "documents.approve_container_mapping": "L3",
    "documents.reject_container_mapping": "L3",
    "shipments.export_details": "L2",
    "shipments.hold_shipment": "L3",
    "shipments.resume_shipment": "L3",
    "shipments.cancel_shipment": "L4",
    "shipments.change_shipment_type": "L3",
    "inventory.create_outward_grn_new_dispatch": "L2",
    "inventory.approve_dispatch": "L3",
    "inventory.reject_dispatch": "L3",
    "inventory.adjust_stock_without_remarks": "L3",
    "inventory.adjust_stock_with_remarks": "L4",
    "inventory.move_inventory": "L3",
    "inventory.modify_lfd": "L3",
    "inventory.returned": "L2",
    "inventory.delivered": "L2",
}


def _sheet_activity_id(activity_code: str) -> str:
    return "activity-" + activity_code.replace(".", "-").replace("_", "-")


def _sheet_activity_group(sub_module: str) -> tuple[str, str]:
    if sub_module in {"Document", "OCR & Extraction"}:
        return ("document", "Document Activities")
    if sub_module == "Generated Documents":
        return ("generation", "Generation Activities")
    if sub_module == "Validation":
        return ("validation", "Validation Activities")
    if sub_module == "Container Mapping":
        return ("container_mapping", "Container Mapping Activities")
    if sub_module == "Active Templates":
        return ("shipment", "Shipment Activities")
    if sub_module == "Inventory":
        return ("inventory", "Inventory Activities")
    slug = sub_module.lower().replace("&", "and").replace(" ", "_")
    return (slug, f"{sub_module} Activities")


def _activity_prefix(group_code: str, module_code: str) -> str:
    return {
        "document": "DOC",
        "generation": "GEN",
        "validation": "VAL",
        "container_mapping": "MAP",
        "shipment": "SHP",
        "inventory": "INV",
    }.get(group_code, module_code[:3].upper())


def _merge_sheet_status_activities(activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    sheet_codes = {row[2] for row in SHEET_STATUS_ACTIVITY_ROWS}
    old_activity_by_code = {
        str(activity["activityCode"]): activity
        for activity in activities
        if str(activity.get("activityCode") or "") in sheet_codes
    }
    for activity in activities:
        code = str(activity["activityCode"])
        if code not in sheet_codes:
            continue
        merged[code] = {**activity, "moduleCode": activity.get("moduleCode") or activity.get("category")}

    group_counts: dict[str, int] = {}
    for module_code, sub_module, activity_code, name, scope, status, remarks in SHEET_STATUS_ACTIVITY_ROWS:
        effective_module_code = ACTIVITY_MODULE_OVERRIDES.get(activity_code, module_code)
        group_code, group_label = _sheet_activity_group(sub_module)
        group_counts[group_code] = group_counts.get(group_code, 0) + 1
        display_code = f"{_activity_prefix(group_code, effective_module_code)}-{group_counts[group_code]:03d}"
        row: dict[str, Any] = {
            "id": _sheet_activity_id(activity_code),
            "activityCode": activity_code,
            "displayCode": display_code,
            "name": name,
            "category": group_code,
            "moduleCode": effective_module_code,
            "displayGroup": group_label,
            "subModule": sub_module,
            "scope": scope,
            "status": status,
            "remarks": remarks,
            "minLevel": old_activity_by_code.get(activity_code, {}).get("minLevel", SHEET_ACTIVITY_MIN_LEVELS.get(activity_code, "L1")),
        }
        if scope and "doc" in scope.lower():
            row["scopeType"] = "docType"
        clean_row = {key: value for key, value in row.items() if value is not None}
        if activity_code in merged:
            merged[activity_code].update(clean_row)
        else:
            merged[activity_code] = clean_row
        order.append(activity_code)

    for activity in activities:
        code = str(activity["activityCode"])
        if code in merged:
            continue
        merged[code] = {
            **activity,
            "moduleCode": ACTIVITY_MODULE_OVERRIDES.get(code, activity.get("moduleCode") or activity.get("category")),
        }
        order.append(code)

    return [merged[code] for code in order]


ACTIVITY_DEFINITIONS = _merge_sheet_status_activities(ACTIVITY_DEFINITIONS)

DISABLED_ACTIVITY_MODULE_CODES = {"accounting", "reports"}
ACTIVITY_DEFINITIONS = [
    activity for activity in ACTIVITY_DEFINITIONS
    if ACTIVITY_MODULE_OVERRIDES.get(
        str(activity.get("activityCode") or ""),
        activity.get("moduleCode") or activity.get("category"),
    ) not in DISABLED_ACTIVITY_MODULE_CODES
]

ACTIVITY_MODULES = {
    activity["activityCode"]: ACTIVITY_MODULE_OVERRIDES.get(activity["activityCode"], activity.get("moduleCode") or activity["category"])
    for activity in ACTIVITY_DEFINITIONS
    if ACTIVITY_MODULE_OVERRIDES.get(activity["activityCode"], activity.get("moduleCode") or activity.get("category")) in {module["moduleCode"] for module in MODULE_DEFINITIONS}
}

ALL_ADMIN_MODULE_CODES = [
    str(module["moduleCode"])
    for module in sorted(MODULE_DEFINITIONS, key=lambda item: int(item.get("sortOrder") or 0))
    if module.get("isActive") and module.get("moduleCode")
]

ALL_ADMIN_ACTIVITY_CODES = [
    str(activity["activityCode"])
    for activity in ACTIVITY_DEFINITIONS
    if activity.get("activityCode") and str(activity.get("activityCode")) in ACTIVITY_MODULES
]

for admin_role_name in ("Super Admin", "Org Admin"):
    if admin_role_name in ROLE_DEFAULTS:
        ROLE_DEFAULTS[admin_role_name]["allowedLevels"] = ["L4"]
        ROLE_DEFAULTS[admin_role_name]["defaultDataScope"] = "ALL"
        ROLE_DEFAULTS[admin_role_name]["defaultModules"] = ALL_ADMIN_MODULE_CODES
        ROLE_DEFAULTS[admin_role_name]["activityCodes"] = ALL_ADMIN_ACTIVITY_CODES


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


class RoleActivitySlaRequest(BaseModel):
    activityCode: str
    activityType: str
    activityName: str
    scope: str
    baseDoc: str
    baseSlaHours: float
    reminderPct: int = 0
    warningPct: int = 50
    escalationPct: int = 75
    blockerPct: int = 100
    description: str | None = None


class RoleProfileRequest(BaseModel):
    name: str
    description: str | None = None
    roleCategory: str | None = None
    color: str | None = None
    allowedLevels: list[str] = []
    defaultDataScope: str | None = None
    documentScope: list[str] = []
    docTypeScopes: dict[str, list[str]] = Field(default_factory=dict)
    defaultModules: list[str] = []
    activityCodes: list[str] = []
    activitySla: list[RoleActivitySlaRequest] = Field(default_factory=list)


class TeamRequest(BaseModel):
    name: str
    function: str | None = None
    region: str | None = None


class EscalationConfigRequest(BaseModel):
    activityType: str | None = None
    activityName: str | None = None
    description: str | None = None
    scope: str | None = None
    baseDoc: str | None = None
    baseSlaHours: float | None = None
    reminderPct: int | None = None
    warningPct: int | None = None
    escalationPct: int | None = None
    blockerPct: int | None = None
    channels: dict[str, Any] | None = None
    targets: dict[str, Any] | None = None


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


class WarehouseRequest(BaseModel):
    name: str = Field(min_length=1)
    address: str | None = None
    firmsCode: str | None = None
    partnerOrgId: str | None = None
    inboundSlaHrs: float | None = None
    outboundSlaHrs: float | None = None
    isActive: bool | None = True


class WarehouseQcChecklistRequest(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


DEFAULT_WAREHOUSE_LOCATIONS: list[dict[str, Any]] = [
    {"id": "default-la-3pl", "name": "Los Angeles 3PL — Pacific Distribution Center", "location_type": "WAREHOUSE"},
    {"id": "default-mundra-cfs", "name": "Mundra CFS — Adani Logistics", "location_type": "PORT"},
    {"id": "default-nhava-sheva-icd", "name": "Nhava Sheva ICD — Gateway Terminals", "location_type": "PORT"},
    {"id": "default-port-baltimore", "name": "Port: Baltimore", "location_type": "PORT"},
    {"id": "default-port-chicago", "name": "Port: Chicago (via rail)", "location_type": "PORT"},
    {"id": "default-port-houston", "name": "Port: Houston", "location_type": "PORT"},
    {"id": "default-port-los-angeles", "name": "Port: Los Angeles", "location_type": "PORT"},
    {"id": "default-port-savannah", "name": "Port: Savannah", "location_type": "PORT"},
    {"id": "default-savannah-3pl", "name": "Savannah 3PL — Atlantic Steel Logistics", "location_type": "WAREHOUSE"},
    {"id": "default-south-houston", "name": "South Houston Steel Receiving Hub", "location_type": "WAREHOUSE"},
]


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
    {"id": "ENTRY_SUMMARY", "typeCode": "ENTRY_SUMMARY", "displayName": "CBP FORM 7501", "shortCode": "CBP", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 50},
    {"id": "DRAFT_CBP_FORM_7501_BROKER", "typeCode": "DRAFT_CBP_FORM_7501_BROKER", "displayName": "Draft CBP FORM 7501_Broker", "shortCode": "CBP", "geography": "US", "hasExtraction": True, "isSystem": True, "sortOrder": 55},
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

DEFAULT_ESCALATION_CHANNELS: dict[str, Any] = {
    "reminder": {"email": False, "freshdesk": False},
    "warning": {"email": True, "freshdesk": False},
    "escalation": {"email": True, "freshdesk": False},
    "blocker": {"email": True, "freshdesk": True},
}

GENERATED_DOCUMENT_SOURCE_DOCS = "Sales Invoice, Packing List, Bill of Lading"

SLA_ACTIVITY_CONFIG_BY_CODE: dict[str, dict[str, str]] = {
    "documents.upload": {
        "activityType": "upload_document",
        "activityName": "Upload Document",
        "description": "SCOPE OF DOCS BASED - every doc to have a SLA",
        "baseDoc": "Doc names",
    },
    "documents.fill_manual_fields": {
        "activityType": "fill_manual_fields",
        "activityName": "Fill Manual Fields",
        "description": "Scope -3 docs",
        "baseDoc": GENERATED_DOCUMENT_SOURCE_DOCS,
    },
    "documents.submit_for_review": {
        "activityType": "submit_for_review",
        "activityName": "Submit for Review",
        "description": "SCOPE OF DOCS BASED - every doc to have a SLA. Edge case: If the doc is rejected - the submit for review timer will start",
        "baseDoc": GENERATED_DOCUMENT_SOURCE_DOCS,
    },
    "documents.approve_generated_document": {
        "activityType": "approve_generated_document",
        "activityName": "Approve Generated Document",
        "description": "",
        "baseDoc": GENERATED_DOCUMENT_SOURCE_DOCS,
    },
    "documents.resolve_validation_failure": {
        "activityType": "resolve_validation_failure",
        "activityName": "Resolve Validation Failure",
        "description": "SCOPE OF DOCS BASED - every doc to have a SLA",
        "baseDoc": "Doc names",
    },
    "documents.map_container_to_sku": {
        "activityType": "map_container_to_sku",
        "activityName": "Map Container to SKU",
        "description": "",
        "baseDoc": "",
    },
    "documents.approve_container_mapping": {
        "activityType": "approve_container_mapping",
        "activityName": "Approve Container Mapping",
        "description": "",
        "baseDoc": "",
    },
}

SLA_ELIGIBLE_ACTIVITY_ROWS: list[tuple[str, str, str, str]] = [
    ("Document", "Upload Document", "SCOPE OF DOCS BASED - every doc to have a SLA", "Doc names"),
    ("Generated Documents", "Fill Manual Fields", "Scope -3 docs", GENERATED_DOCUMENT_SOURCE_DOCS),
    (
        "Generated Documents",
        "Submit for Review",
        "SCOPE OF DOCS BASED - every doc to have a SLA. Edge case: If the doc is rejected - the submit for review timer will start",
        GENERATED_DOCUMENT_SOURCE_DOCS,
    ),
    ("Generated Documents", "Approve Generated Document", "", GENERATED_DOCUMENT_SOURCE_DOCS),
    ("Validation", "Resolve Validation Failure", "SCOPE OF DOCS BASED - every doc to have a SLA", "Doc names"),
    ("", "Map Container to SKU", "", ""),
    ("", "Approve Container Mapping", "", ""),
]

def _slug(value: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in value.strip())
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug.strip("_") or "activity"


def _escalation_config_from_sla_row(index: int, scope: str, activity_name: str, description: str, base_doc: str) -> dict[str, Any]:
    activity_type = _slug(activity_name)
    return {
        "id": f"sla_{index:03d}_{activity_type}",
        "activityType": activity_type,
        "activityName": activity_name,
        "description": description,
        "scope": scope,
        "baseDoc": base_doc,
        "baseSlaHours": 24,
        "reminderPct": 0,
        "warningPct": 50,
        "escalationPct": 75,
        "blockerPct": 100,
        "channels": DEFAULT_ESCALATION_CHANNELS,
        "targets": {},
    }


DEFAULT_ESCALATION_CONFIGS: list[dict[str, Any]] = [
    _escalation_config_from_sla_row(index, scope, activity_name, description, base_doc)
    for index, (scope, activity_name, description, base_doc) in enumerate(SLA_ELIGIBLE_ACTIVITY_ROWS, start=1)
]

def _escalation_row_to_config(row: dict[str, Any]) -> dict[str, Any]:
    channels = row.get("channels")
    targets = row.get("targets")
    if isinstance(channels, str):
        try:
            channels = json.loads(channels)
        except Exception:
            channels = {}
    if isinstance(targets, str):
        try:
            targets = json.loads(targets)
        except Exception:
            targets = {}
    return {
        "id": str(row.get("id") or ""),
        "activityType": row.get("activity_type") or "",
        "activityName": row.get("activity_name") or "",
        "description": row.get("description") or "",
        "scope": row.get("scope") or "",
        "baseDoc": row.get("base_doc") or "",
        "baseSlaHours": float(row.get("base_sla_hours") or 24),
        "reminderPct": int(row.get("reminder_pct") or 0),
        "warningPct": int(row.get("warning_pct") or 50),
        "escalationPct": int(row.get("escalation_pct") or 75),
        "blockerPct": int(row.get("blocker_pct") or 100),
        "channels": channels or DEFAULT_ESCALATION_CHANNELS,
        "targets": targets or {},
    }

def _role_value(role) -> str:
    return getattr(role, "value", None) or str(role)


def _role_definition(role) -> dict:
    role_value = _role_from_request(_role_value(role))
    return next((item for item in ROLE_DEFINITIONS if item["id"] == role_value), ROLE_DEFINITIONS[-1])


def _role_from_request(role_id: str) -> str:
    normalized = role_id.strip()
    known_roles = {item["id"] for item in ROLE_DEFINITIONS}
    return ROLE_ALIASES.get(normalized.lower(), normalized if normalized in known_roles else "India Logistics")


def _canonical_role_name(role_name: str) -> str:
    return ROLE_ALIASES.get(str(role_name or "").strip().lower(), str(role_name or "").strip())


def _keycloak_role_name_for_role(role_name: str) -> str:
    canonical_name = _canonical_role_name(role_name)
    return DEFAULT_KEYCLOAK_ROLE_NAMES.get(canonical_name, canonical_name)


def _keycloak_role_lookup_names(role_name: str) -> list[str]:
    canonical_name = _canonical_role_name(role_name)
    candidates = [
        str(role_name or "").strip(),
        canonical_name,
        DEFAULT_KEYCLOAK_ROLE_NAMES.get(canonical_name, canonical_name),
    ]
    names: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in names:
            names.append(candidate)
    return names


def _display_role_name(role_name: str) -> str:
    return role_name.replace("_", " ").replace("-", " ").title()


def _role_category(role_name: str) -> str:
    normalized = _role_from_request(role_name)
    defaults = ROLE_DEFAULTS.get(normalized, {})
    return str(defaults.get("roleCategory") or "INTERNAL_SPECIALIST")


def _normalize_data_scope(scope: str) -> str:
    normalized = str(scope or "").strip().upper()
    if normalized in {"ALL", "TEAM", "TAGGED"}:
        return normalized
    if normalized in {"ASSIGNED", "ASSIGNED_ONLY"}:
        return "TAGGED"
    return "TEAM"


def _is_external_access_user(attrs: dict, role_category: str = "") -> bool:
    org_id = _attr_value(attrs, "ewms.orgId", "default-org").strip()
    if org_id in {"", "default-org"}:
        return False
    user_type = _attr_value(attrs, "ewms.userType", "").strip().lower()
    if user_type in {"external", "partner"}:
        return True
    if user_type == "internal":
        return False
    return str(role_category or "").strip().lower() in {"org_external", "external", "partner"}


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


def _attr_json_value(attributes: dict | None, key: str, default: str = "") -> str:
    chunk_count_text = _attr_value(attributes, f"{key}.__chunks", "")
    if chunk_count_text.isdigit():
        chunk_count = int(chunk_count_text)
        if chunk_count == 0:
            return _attr_value(attributes, key, default)
        chunks = [_attr_value(attributes, f"{key}.{index}", "") for index in range(chunk_count)]
        if all(chunks):
            return "".join(chunks)
        return default
    chunks: list[tuple[int, str]] = []
    prefix = f"{key}."
    for attr_key, values in (attributes or {}).items():
        if not str(attr_key).startswith(prefix):
            continue
        suffix = str(attr_key)[len(prefix):]
        if not suffix.isdigit():
            continue
        chunk = _attr_value(attributes, str(attr_key), "")
        if chunk:
            chunks.append((int(suffix), chunk))
    if not chunks:
        return _attr_value(attributes, key, default)
    return "".join(chunk for _, chunk in sorted(chunks))


def _set_json_attr(attributes: dict[str, list[str]], key: str, value: Any) -> None:
    raw = json.dumps(value, sort_keys=True)
    if len(raw) <= KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX:
        attributes[key] = [raw]
        attributes[f"{key}.__chunks"] = ["0"]
        return
    for index, start in enumerate(range(0, len(raw), KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX)):
        attributes[f"{key}.{index}"] = [raw[start:start + KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX]]
    attributes[f"{key}.__chunks"] = [str((len(raw) + KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX - 1) // KEYCLOAK_ROLE_ATTRIBUTE_VALUE_MAX)]


def _role_id_from_name(name: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in name.strip().upper())
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized.strip("_") or "CUSTOM_ROLE"


def _default_document_scope(role_name: str, defaults: dict[str, Any]) -> list[str]:
    configured = defaults.get("documentScope")
    if configured:
        return sorted({str(item) for item in configured if str(item)})
    from helpers.rbac_data_access import ALL_DOCUMENT_ACCESS_ROLES, ROLE_DOCUMENT_TYPES, normalize_role_name

    normalized = normalize_role_name(role_name)
    if normalized in ALL_DOCUMENT_ACCESS_ROLES:
        return sorted({str(item["typeCode"]) for item in DOC_TYPE_REGISTRY})
    return sorted(ROLE_DOCUMENT_TYPES.get(normalized, set()))


def _normalize_doc_type_list(values: list[str] | None) -> list[str]:
    return sorted({str(item).strip().upper() for item in values or [] if str(item).strip()})


def _doc_type_display_name(type_code: str) -> str:
    normalized = str(type_code or "").strip().upper()
    for item in DOC_TYPE_REGISTRY:
        if str(item.get("typeCode") or "").upper() == normalized:
            return str(item.get("displayName") or normalized)
    return normalized


def _parse_doc_type_scopes(attrs: dict | None) -> dict[str, list[str]]:
    raw = _attr_json_value(attrs, "ewms.docTypeScopes", "")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    scopes: dict[str, list[str]] = {}
    for activity_code, values in parsed.items():
        if isinstance(values, list):
            scopes[str(activity_code)] = _normalize_doc_type_list(values)
    return scopes


def _parse_activity_sla(attrs: dict | None) -> list[dict[str, Any]]:
    raw = _attr_json_value(attrs, "ewms.activitySla", "")
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [
        item for item in parsed
        if isinstance(item, dict)
        and str(item.get("activityCode") or "").strip()
        and str(item.get("activityType") or "").strip()
        and str(item.get("scope") or "").strip()
    ]


def _activity_sla_from_request(request: RoleProfileRequest) -> list[dict[str, Any]]:
    enabled_activity_codes = _enabled_activity_codes_from_request(request)
    rows: list[dict[str, Any]] = []
    for item in request.activitySla or []:
        activity_code = str(item.activityCode or "").strip()
        if activity_code not in enabled_activity_codes:
            continue
        activity_type = str(item.activityType or "").strip()
        activity_name = str(item.activityName or activity_type).strip()
        scope = str(item.scope or "").strip()
        base_doc = str(item.baseDoc or "").strip()
        if not activity_code or not activity_type or not activity_name or not scope:
            continue
        base_sla_hours = float(item.baseSlaHours or 0)
        if base_sla_hours <= 0:
            continue
        rows.append({
            "activityCode": activity_code,
            "activityType": activity_type,
            "activityName": activity_name,
            "description": item.description or "",
            "scope": scope,
            "baseDoc": base_doc,
            "baseSlaHours": base_sla_hours,
            "reminderPct": max(0, min(100, int(item.reminderPct))),
            "warningPct": max(0, min(100, int(item.warningPct))),
            "escalationPct": max(0, min(100, int(item.escalationPct))),
            "blockerPct": max(0, min(100, int(item.blockerPct))),
        })
    return rows


def _validate_role_activity_sla(request: RoleProfileRequest, activity_sla: list[dict[str, Any]]) -> None:
    selected_codes = _enabled_activity_codes_from_request(request)
    if not selected_codes:
        return
    activities_by_code = {
        str(activity.get("activityCode") or ""): activity
        for activity in ACTIVITY_DEFINITIONS
    }
    rows_by_key = {
        (
            str(item.get("activityCode") or "").strip(),
            str(item.get("scope") or "").strip().lower(),
        ): item
        for item in activity_sla
    }
    doc_type_scopes = _doc_type_scopes_from_request(request)
    missing: list[str] = []
    invalid: list[str] = []
    for activity_code in selected_codes:
        sla_config = SLA_ACTIVITY_CONFIG_BY_CODE.get(activity_code)
        if not sla_config:
            continue
        activity = activities_by_code.get(activity_code, {})
        scopes = doc_type_scopes.get(activity_code, []) if activity.get("scopeType") == "docType" else []
        if activity.get("scopeType") == "docType" and not scopes:
            scopes = _normalize_doc_type_list(request.documentScope)
        if not scopes:
            fallback_scope = str(activity.get("scope") or sla_config.get("baseDoc") or "Default").strip()
            scopes = [fallback_scope]
        for scope in scopes:
            scope_text = str(scope).strip()
            scope_candidates = {scope_text.lower()}
            if activity.get("scopeType") == "docType":
                scope_candidates.add(_doc_type_display_name(scope_text).strip().lower())
            row = next((rows_by_key.get((activity_code, candidate)) for candidate in scope_candidates if rows_by_key.get((activity_code, candidate))), None)
            label = f"{sla_config['activityName']} - {_doc_type_display_name(scope_text) if activity.get('scopeType') == 'docType' else scope_text}"
            if not row:
                missing.append(label)
                continue
            if float(row.get("baseSlaHours") or 0) <= 0 or not str(row.get("baseDoc") or "").strip():
                invalid.append(label)
                continue
            thresholds = [
                row.get("reminderPct"),
                row.get("warningPct"),
                row.get("escalationPct"),
                row.get("blockerPct"),
            ]
            if any(not isinstance(value, int) or value < 0 or value > 100 for value in thresholds):
                invalid.append(label)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing SLA for: {', '.join(missing)}")
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid SLA for: {', '.join(invalid)}")


def _doc_type_scopes_from_request(request: RoleProfileRequest) -> dict[str, list[str]]:
    enabled_activity_codes = _enabled_activity_codes_from_request(request)
    scopes: dict[str, list[str]] = {}
    for activity_code, values in (request.docTypeScopes or {}).items():
        if str(activity_code) not in enabled_activity_codes:
            continue
        normalized = _normalize_doc_type_list(values)
        if normalized:
            scopes[str(activity_code)] = normalized
    return scopes


def _enabled_modules_from_request(request: RoleProfileRequest) -> set[str]:
    return {str(module).strip() for module in request.defaultModules or [] if str(module).strip()}


def _enabled_activity_codes_from_request(request: RoleProfileRequest) -> set[str]:
    modules = _enabled_modules_from_request(request)
    enabled: set[str] = set()
    for activity_code in request.activityCodes or []:
        code = str(activity_code).strip()
        module = ACTIVITY_MODULES.get(code)
        if not code or not module:
            continue
        if module in modules or (module == "admin" and "settings" in modules) or ("partner" in modules and module in {"documents", "shipments", "inventory", "warehouse"}):
            enabled.add(code)
    return enabled


def _keycloak_attr_values(values: list[Any] | tuple[Any, ...] | set[Any] | None) -> list[str]:
    normalized = [str(value) for value in values or [] if str(value)]
    return normalized or [""]


def _role_profile_from_keycloak(role: dict, *, user_count: int = 0, detail: bool = False) -> dict[str, Any]:
    role_name = str(role.get("name") or "")
    default_key = role_name if role_name in ROLE_DEFAULTS else ROLE_ALIASES.get(role_name.lower(), "")
    defaults = ROLE_DEFAULTS.get(default_key, {})
    attrs = role.get("attributes") or {}
    is_admin_default_role = default_key in {"Super Admin", "Org Admin"}
    modules = ALL_ADMIN_MODULE_CODES if is_admin_default_role else (_attr_values(attrs, "ewms.modules") or list(defaults.get("defaultModules", [])))
    levels = ["L4"] if is_admin_default_role else (_attr_values(attrs, "ewms.levels") or list(defaults.get("allowedLevels", [])))
    activity_codes = ALL_ADMIN_ACTIVITY_CODES if is_admin_default_role else (_attr_values(attrs, "ewms.activities") or list(defaults.get("activityCodes", [])))
    document_scope = _attr_values(attrs, "ewms.documentScope") or _default_document_scope(role_name, defaults)
    doc_type_scopes = _parse_doc_type_scopes(attrs)
    activity_sla = _parse_activity_sla(attrs)
    scoped_activity_codes = {
        str(activity["activityCode"])
        for activity in ACTIVITY_DEFINITIONS
        if activity.get("scopeType") == "docType"
    }
    for activity_code in scoped_activity_codes:
        if activity_code in activity_codes and activity_code not in doc_type_scopes and document_scope:
            doc_type_scopes[activity_code] = list(document_scope)
    role_id = default_key if default_key in ROLE_DEFAULTS else role_name
    is_reference_role = default_key in ROLE_DEFAULTS
    display_name = str(defaults.get("name") or _display_role_name(role_name)) if is_reference_role else _attr_value(attrs, "ewms.displayName", _display_role_name(role_name))
    role_category = str(defaults.get("roleCategory") or _role_category(role_name)) if is_reference_role else _attr_value(attrs, "ewms.category", _role_category(role_name))
    row = {
        "id": role_id,
        "name": display_name,
        "displayName": display_name,
        "description": role.get("description") or defaults.get("description"),
        "roleCategory": role_category,
        "profileCategory": ROLE_PROFILE_CATEGORIES.get(role_category, role_category),
        "isActive": True,
        "isSystemDefault": default_key in ROLE_DEFAULTS or role_name.lower() in {"admin", "user"},
        "systemCode": ROLE_SYSTEM_CODES.get(default_key),
        "color": _attr_value(attrs, "ewms.color", str(defaults.get("color") or "#64748b")),
        "allowedLevels": levels,
        "defaultModules": modules,
        "defaultDataScope": _attr_value(attrs, "ewms.dataScope", str(defaults.get("defaultDataScope") or "TEAM")),
        "documentScope": document_scope,
        "docTypeScopes": doc_type_scopes,
        "activitySla": activity_sla,
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
                "docTypePerms": [
                    {"action": activity_code, "activityCode": activity_code, "docType": doc_type}
                    for activity_code, doc_types in doc_type_scopes.items()
                    for doc_type in doc_types
                ],
                "ticketPerms": [],
                "gateAssignments": [],
            }
        )
    return row


def _default_role_source_priority(role_name: str) -> int:
    canonical_name = _canonical_role_name(role_name)
    if canonical_name not in ROLE_DEFAULTS:
        return 0
    if role_name == canonical_name:
        return 3
    if role_name == DEFAULT_KEYCLOAK_ROLE_NAMES.get(canonical_name):
        return 2
    return 1


def _role_payload_from_request(request: RoleProfileRequest, *, role_id: str | None = None) -> dict[str, Any]:
    name = role_id or _role_id_from_name(request.name)
    is_admin_role = _canonical_role_name(name) in {"Super Admin", "Org Admin"} or _canonical_role_name(request.name) in {"Super Admin", "Org Admin"}
    modules = set(ALL_ADMIN_MODULE_CODES) if is_admin_role else _enabled_modules_from_request(request)
    activity_codes = sorted(ALL_ADMIN_ACTIVITY_CODES if is_admin_role else _enabled_activity_codes_from_request(request))
    doc_type_scopes = _doc_type_scopes_from_request(request)
    document_scope = _normalize_doc_type_list(request.documentScope)
    if not document_scope and doc_type_scopes:
        document_scope = sorted({doc_type for doc_types in doc_type_scopes.values() for doc_type in doc_types})
    activity_sla = _activity_sla_from_request(request)
    attributes = {
        "ewms.displayName": _keycloak_attr_values([request.name]),
        "ewms.category": _keycloak_attr_values([request.roleCategory or "org_internal"]),
        "ewms.color": _keycloak_attr_values([request.color or "#64748b"]),
        "ewms.levels": _keycloak_attr_values(["L4"] if is_admin_role else (request.allowedLevels or ["L1"])),
        "ewms.dataScope": _keycloak_attr_values(["ALL"] if is_admin_role else [request.defaultDataScope or "TEAM"]),
        "ewms.documentScope": _keycloak_attr_values(document_scope),
        "ewms.modules": _keycloak_attr_values(sorted(modules)),
        "ewms.activities": _keycloak_attr_values(activity_codes),
        "ewms.managedBy": ["ewms-admin"],
    }
    _set_json_attr(attributes, "ewms.activitySla", activity_sla)
    _set_json_attr(attributes, "ewms.docTypeScopes", doc_type_scopes)
    return {
        "name": name,
        "description": request.description or "",
        "attributes": attributes,
    }


def _clean_keycloak_role_update_payload(payload: dict[str, Any]) -> dict[str, Any]:
    cleaned = {key: value for key, value in payload.items() if key != "id"}
    attrs = cleaned.get("attributes")
    if isinstance(attrs, dict):
        cleaned["attributes"] = {
            str(key): [str(item) for item in value if str(item)]
            for key, value in attrs.items()
            if isinstance(value, list) and any(str(item) for item in value)
        }
    return cleaned


def _keycloak_role_update_payload(existing: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    cleaned_payload = _clean_keycloak_role_update_payload(payload)
    update_payload = dict(existing or {})
    update_payload.update(cleaned_payload)
    role_id = existing.get("id")
    if role_id:
        update_payload["id"] = role_id
    update_payload["name"] = str(existing.get("name") or payload.get("name") or "")
    update_payload["description"] = str(payload.get("description") or "")
    update_payload["attributes"] = cleaned_payload.get("attributes") or {}
    return {
        key: value
        for key, value in update_payload.items()
        if value is not None and key not in {"access"}
    }


def _update_keycloak_role(keycloak_admin, existing: dict[str, Any], payload: dict[str, Any]) -> None:
    role_name = str(existing.get("name") or payload.get("name") or "")
    update_payload = _keycloak_role_update_payload(existing, payload)
    role_id = str(existing.get("id") or "")
    first_exc: Exception | None = None
    if role_id and hasattr(keycloak_admin, "update_role_by_id"):
        try:
            keycloak_admin.update_role_by_id(role_id, update_payload)
            return
        except Exception as exc:
            first_exc = exc
    try:
        keycloak_admin.update_realm_role(role_name, update_payload)
        return
    except Exception as name_exc:
        if first_exc is None:
            first_exc = name_exc
        fallback_payload = {
            "name": role_name,
            "description": str(update_payload.get("description") or ""),
            "attributes": update_payload.get("attributes") or {},
        }
        if role_id:
            fallback_payload["id"] = role_id
        if role_id and hasattr(keycloak_admin, "update_role_by_id"):
            try:
                keycloak_admin.update_role_by_id(role_id, fallback_payload)
                return
            except Exception:
                pass
        try:
            keycloak_admin.update_realm_role(role_name, fallback_payload)
            return
        except Exception:
            raise first_exc


def _default_role_request(role_name: str) -> RoleProfileRequest:
    canonical_name = _canonical_role_name(role_name)
    defaults = ROLE_DEFAULTS[canonical_name]
    return RoleProfileRequest(
        name=canonical_name,
        description=str(defaults.get("description") or ""),
        roleCategory=str(defaults.get("roleCategory") or "INTERNAL_SPECIALIST"),
        color=str(defaults.get("color") or "#64748b"),
        allowedLevels=list(defaults.get("allowedLevels") or ["L1"]),
        defaultDataScope=str(defaults.get("defaultDataScope") or "TEAM"),
        documentScope=_default_document_scope(canonical_name, defaults),
        defaultModules=list(defaults.get("defaultModules") or []),
        activityCodes=list(defaults.get("activityCodes") or []),
    )


def _ensure_keycloak_role(keycloak_admin, role_name: str) -> dict:
    first_exc: Exception | None = None
    for keycloak_role_name in _keycloak_role_lookup_names(role_name):
        try:
            return keycloak_admin.get_realm_role(keycloak_role_name)
        except Exception as exc:
            if first_exc is None:
                first_exc = exc
    canonical_name = _canonical_role_name(role_name)
    if canonical_name not in ROLE_DEFAULTS:
        if first_exc:
            raise first_exc
        raise KeyError(role_name)
    keycloak_role_name = canonical_name
    try:
        payload = _role_payload_from_request(_default_role_request(canonical_name), role_id=keycloak_role_name)
        try:
            keycloak_admin.create_realm_role(payload, skip_exists=True)
        except Exception:
            pass
        return keycloak_admin.get_realm_role(keycloak_role_name)
    except Exception:
        fallback_name = DEFAULT_KEYCLOAK_ROLE_NAMES.get(canonical_name, canonical_name)
        if fallback_name == keycloak_role_name:
            raise
        payload = _role_payload_from_request(_default_role_request(canonical_name), role_id=fallback_name)
        try:
            keycloak_admin.create_realm_role(payload, skip_exists=True)
        except Exception:
            pass
        return keycloak_admin.get_realm_role(fallback_name)


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


async def _ensure_warehouse_locations_table(prisma) -> None:
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."warehouse_locations" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "address" TEXT,
          "firms_code" TEXT,
          "partner_org_id" TEXT,
          "inbound_sla_hrs" DOUBLE PRECISION,
          "outbound_sla_hrs" DOUBLE PRECISION,
          "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
          "qc_checklist" JSONB,
          "location_type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS "idx_warehouse_locations_active"
        ON "public"."warehouse_locations" ("is_active", "location_type")
        """,
    )
    for item in DEFAULT_WAREHOUSE_LOCATIONS:
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."warehouse_locations" (
              "id", "name", "is_active", "location_type"
            )
            VALUES ($1, $2, TRUE, $3)
            ON CONFLICT ("id") DO NOTHING
            """,
            item["id"],
            item["name"],
            item["location_type"],
        )


def _warehouse_row(row: dict[str, Any]) -> dict[str, Any]:
    qc = row.get("qc_checklist")
    if isinstance(qc, str):
        try:
            qc = json.loads(qc)
        except json.JSONDecodeError:
            qc = None
    return {
        "id": str(row.get("id") or ""),
        "name": row.get("name") or "",
        "address": row.get("address"),
        "firmsCode": row.get("firms_code"),
        "partnerOrgId": row.get("partner_org_id"),
        "inboundSlaHrs": row.get("inbound_sla_hrs"),
        "outboundSlaHrs": row.get("outbound_sla_hrs"),
        "isActive": bool(row.get("is_active")),
        "locationType": row.get("location_type") or "WAREHOUSE",
        "qcChecklist": qc,
    }


async def _list_warehouse_locations(prisma, *, active_only: bool = False) -> list[dict[str, Any]]:
    await _ensure_warehouse_locations_table(prisma)
    where = 'WHERE "is_active" = TRUE' if active_only else ''
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          "id", "name", "address", "firms_code", "partner_org_id",
          "inbound_sla_hrs", "outbound_sla_hrs", "is_active", "location_type", "qc_checklist"
        FROM "public"."warehouse_locations"
        {where}
        ORDER BY "name"
        """,
    )
    return [_warehouse_row(row) for row in rows]


async def _ensure_escalation_config_table(prisma) -> None:
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."escalation_configs" (
          "id" TEXT PRIMARY KEY,
          "activity_type" TEXT NOT NULL,
          "activity_name" TEXT NOT NULL,
          "description" TEXT NOT NULL DEFAULT '',
          "scope" TEXT NOT NULL DEFAULT '',
          "base_doc" TEXT NOT NULL DEFAULT '',
          "base_sla_hours" DOUBLE PRECISION NOT NULL DEFAULT 24,
          "reminder_pct" INTEGER NOT NULL DEFAULT 0,
          "warning_pct" INTEGER NOT NULL DEFAULT 50,
          "escalation_pct" INTEGER NOT NULL DEFAULT 75,
          "blocker_pct" INTEGER NOT NULL DEFAULT 100,
          "channels" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "targets" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS "idx_escalation_configs_activity_type"
        ON "public"."escalation_configs" ("activity_type")
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS "idx_escalation_configs_scope"
        ON "public"."escalation_configs" ("scope")
        """,
    )


async def _seed_default_escalation_configs(prisma) -> None:
    await _ensure_escalation_config_table(prisma)
    for item in DEFAULT_ESCALATION_CONFIGS:
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."escalation_configs" (
              "id", "activity_type", "activity_name", "description", "scope", "base_doc",
              "base_sla_hours", "reminder_pct", "warning_pct", "escalation_pct", "blocker_pct",
              "channels", "targets"
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb
            )
            ON CONFLICT ("id") DO NOTHING
            """,
            str(item["id"]),
            str(item["activityType"]),
            str(item["activityName"]),
            str(item.get("description") or ""),
            str(item.get("scope") or ""),
            str(item.get("baseDoc") or ""),
            float(item.get("baseSlaHours") or 24),
            int(item.get("reminderPct") or 0),
            int(item.get("warningPct") or 50),
            int(item.get("escalationPct") or 75),
            int(item.get("blockerPct") or 100),
            json.dumps(item.get("channels") or DEFAULT_ESCALATION_CHANNELS),
            json.dumps(item.get("targets") or {}),
        )


async def _list_escalation_configs(prisma) -> list[dict[str, Any]]:
    await _seed_default_escalation_configs(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT *
        FROM "public"."escalation_configs"
        ORDER BY "activity_name" ASC, "scope" ASC, "id" ASC
        """,
    )
    return [_escalation_row_to_config(row) for row in rows]


async def _get_escalation_config(prisma, config_id: str) -> dict[str, Any] | None:
    await _seed_default_escalation_configs(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT *
        FROM "public"."escalation_configs"
        WHERE "id" = $1
        LIMIT 1
        """,
        config_id,
    )
    return _escalation_row_to_config(rows[0]) if rows else None


async def _next_escalation_config_id_db(prisma, activity_type: str, scope: str = "") -> str:
    await _seed_default_escalation_configs(prisma)
    base = f"sla_custom_{_slug(activity_type)}"
    scope_slug = _slug(scope)
    if scope_slug:
        base = f"{base}_{scope_slug}"
    rows = await _query_raw(
        prisma,
        """
        SELECT "id"
        FROM "public"."escalation_configs"
        WHERE "id" = $1 OR "id" LIKE $2
        """,
        base,
        f"{base}_%",
    )
    existing = {str(row["id"]) for row in rows}
    candidate = base
    index = 2
    while candidate in existing:
        candidate = f"{base}_{index}"
        index += 1
    return candidate


async def _find_escalation_config_by_activity_scope(prisma, activity_type: str, scope: str) -> dict[str, Any] | None:
    await _seed_default_escalation_configs(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT *
        FROM "public"."escalation_configs"
        WHERE LOWER("activity_type") = LOWER($1)
          AND LOWER(COALESCE("scope", '')) = LOWER($2)
        ORDER BY "id" ASC
        LIMIT 1
        """,
        activity_type,
        scope,
    )
    return _escalation_row_to_config(rows[0]) if rows else None


async def _upsert_activity_sla_configs(prisma, activity_sla: list[dict[str, Any]]) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    if not activity_sla:
        return saved
    await _seed_default_escalation_configs(prisma)
    for item in activity_sla:
        activity_type = str(item.get("activityType") or "").strip()
        activity_name = str(item.get("activityName") or activity_type).strip()
        scope = str(item.get("scope") or "").strip()
        if not activity_type or not activity_name or not scope:
            continue
        existing = await _find_escalation_config_by_activity_scope(prisma, activity_type, scope)
        config_id = existing["id"] if existing else await _next_escalation_config_id_db(prisma, activity_type, scope)
        current = {
            "id": config_id,
            "activityType": activity_type,
            "activityName": activity_name,
            "description": item.get("description") or (existing or {}).get("description") or "",
            "scope": scope,
            "baseDoc": item.get("baseDoc") or (existing or {}).get("baseDoc") or "",
            "baseSlaHours": float(item.get("baseSlaHours") or (existing or {}).get("baseSlaHours") or 24),
            "reminderPct": int(item.get("reminderPct") if item.get("reminderPct") is not None else (existing or {}).get("reminderPct", 0)),
            "warningPct": int(item.get("warningPct") if item.get("warningPct") is not None else (existing or {}).get("warningPct", 50)),
            "escalationPct": int(item.get("escalationPct") if item.get("escalationPct") is not None else (existing or {}).get("escalationPct", 75)),
            "blockerPct": int(item.get("blockerPct") if item.get("blockerPct") is not None else (existing or {}).get("blockerPct", 100)),
            "channels": (existing or {}).get("channels") or DEFAULT_ESCALATION_CHANNELS,
            "targets": (existing or {}).get("targets") or {},
        }
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."escalation_configs" (
              "id", "activity_type", "activity_name", "description", "scope", "base_doc",
              "base_sla_hours", "reminder_pct", "warning_pct", "escalation_pct", "blocker_pct",
              "channels", "targets"
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb
            )
            ON CONFLICT ("id") DO UPDATE
            SET "activity_type" = EXCLUDED."activity_type",
                "activity_name" = EXCLUDED."activity_name",
                "description" = EXCLUDED."description",
                "scope" = EXCLUDED."scope",
                "base_doc" = EXCLUDED."base_doc",
                "base_sla_hours" = EXCLUDED."base_sla_hours",
                "reminder_pct" = EXCLUDED."reminder_pct",
                "warning_pct" = EXCLUDED."warning_pct",
                "escalation_pct" = EXCLUDED."escalation_pct",
                "blocker_pct" = EXCLUDED."blocker_pct",
                "channels" = EXCLUDED."channels",
                "targets" = EXCLUDED."targets",
                "updated_at" = NOW()
            """,
            config_id,
            activity_type,
            activity_name,
            str(current["description"]),
            scope,
            str(current["baseDoc"]),
            float(current["baseSlaHours"]),
            int(current["reminderPct"]),
            int(current["warningPct"]),
            int(current["escalationPct"]),
            int(current["blockerPct"]),
            json.dumps(current["channels"]),
            json.dumps(current["targets"]),
        )
        saved.append(current)
    return saved


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
        groups = _safe_keycloak_groups(keycloak_admin)
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


@router.get("/activities/sla")
@legacy_router.get("/activities/sla")
async def list_admin_activity_sla(_user=Depends(get_admin_user)):
    prisma = await get_prisma()
    configs = await _list_escalation_configs(prisma)
    by_activity_scope = {
        f"{str(item.get('activityType') or '').lower()}::{str(item.get('scope') or '').lower()}": item
        for item in configs
    }
    definitions = []
    for activity in ACTIVITY_DEFINITIONS:
        activity_code = str(activity.get("activityCode") or "")
        sla_config = SLA_ACTIVITY_CONFIG_BY_CODE.get(activity_code)
        if not sla_config:
            continue
        activity_type = sla_config["activityType"]
        definitions.append({
            "activityCode": activity_code,
            "activityType": activity_type,
            "activityName": sla_config["activityName"],
            "description": sla_config["description"],
            "baseDoc": sla_config["baseDoc"],
            "scopeType": activity.get("scopeType"),
            "scope": activity.get("scope"),
            "defaults": {
                "baseSlaHours": 24,
                "reminderPct": 0,
                "warningPct": 50,
                "escalationPct": 75,
                "blockerPct": 100,
            },
            "existing": [
                item for key, item in by_activity_scope.items()
                if key.startswith(f"{activity_type.lower()}::")
            ],
        })
    return {"ok": True, "data": definitions}


@router.get("/warehouses")
@legacy_router.get("/warehouses")
async def list_admin_warehouses(_user=Depends(get_admin_user)):
    prisma = await get_prisma()
    return {"ok": True, "data": await _list_warehouse_locations(prisma)}


@router.post("/warehouses")
@legacy_router.post("/warehouses")
async def create_admin_warehouse(request: WarehouseRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    await _ensure_warehouse_locations_table(prisma)
    warehouse_id = str(uuid4())
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."warehouse_locations" (
          "id", "name", "address", "firms_code", "partner_org_id",
          "inbound_sla_hrs", "outbound_sla_hrs", "is_active", "location_type"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'WAREHOUSE')
        """,
        warehouse_id,
        request.name.strip(),
        request.address,
        request.firmsCode,
        request.partnerOrgId,
        request.inboundSlaHrs,
        request.outboundSlaHrs,
        request.isActive if request.isActive is not None else True,
    )
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "name", "address", "firms_code", "partner_org_id",
          "inbound_sla_hrs", "outbound_sla_hrs", "is_active", "qc_checklist"
        FROM "public"."warehouse_locations"
        WHERE "id" = $1
        """,
        warehouse_id,
    )
    return {"ok": True, "data": _warehouse_row(rows[0])}


@router.put("/warehouses/{warehouse_id}")
@legacy_router.put("/warehouses/{warehouse_id}")
async def update_admin_warehouse(warehouse_id: str, request: WarehouseRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    await _ensure_warehouse_locations_table(prisma)
    existing = await _query_raw(
        prisma,
        'SELECT "id" FROM "public"."warehouse_locations" WHERE "id" = $1',
        warehouse_id,
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."warehouse_locations"
        SET
          "name" = $2,
          "address" = $3,
          "firms_code" = $4,
          "partner_org_id" = $5,
          "inbound_sla_hrs" = $6,
          "outbound_sla_hrs" = $7,
          "is_active" = $8,
          "updated_at" = NOW()
        WHERE "id" = $1
        """,
        warehouse_id,
        request.name.strip(),
        request.address,
        request.firmsCode,
        request.partnerOrgId,
        request.inboundSlaHrs,
        request.outboundSlaHrs,
        request.isActive if request.isActive is not None else True,
    )
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "name", "address", "firms_code", "partner_org_id",
          "inbound_sla_hrs", "outbound_sla_hrs", "is_active", "qc_checklist"
        FROM "public"."warehouse_locations"
        WHERE "id" = $1
        """,
        warehouse_id,
    )
    return {"ok": True, "data": _warehouse_row(rows[0])}


@router.put("/warehouses/{warehouse_id}/qc-checklist")
@legacy_router.put("/warehouses/{warehouse_id}/qc-checklist")
async def update_admin_warehouse_qc_checklist(
    warehouse_id: str,
    request: WarehouseQcChecklistRequest,
    _user=Depends(get_admin_user),
):
    prisma = await get_prisma()
    await _ensure_warehouse_locations_table(prisma)
    existing = await _query_raw(
        prisma,
        'SELECT "id" FROM "public"."warehouse_locations" WHERE "id" = $1',
        warehouse_id,
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    payload = {"warehouseId": warehouse_id, "items": request.items}
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."warehouse_locations"
        SET "qc_checklist" = $2::jsonb, "updated_at" = NOW()
        WHERE "id" = $1
        """,
        warehouse_id,
        json.dumps(payload),
    )
    return {"ok": True, "data": payload}


@router.get("/escalation")
@legacy_router.get("/escalation")
async def list_admin_escalation(_user=Depends(get_admin_user)):
    prisma = await get_prisma()
    return {"ok": True, "data": await _list_escalation_configs(prisma)}


@router.post("/escalation")
@legacy_router.post("/escalation")
async def create_admin_escalation(request: EscalationConfigRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    data = request.model_dump(exclude_unset=True)
    activity_type = str(data.get("activityType") or "").strip()
    activity_name = str(data.get("activityName") or activity_type).strip()
    if not activity_type or not activity_name:
        return {"ok": False, "error": "Activity type and name are required."}

    scope = str(data.get("scope") or "").strip()
    config_id = await _next_escalation_config_id_db(prisma, activity_type, scope)
    current = {
        "id": config_id,
        "activityType": activity_type,
        "activityName": activity_name,
        "description": data.get("description") or "",
        "scope": scope,
        "baseDoc": data.get("baseDoc") or "",
        "baseSlaHours": data.get("baseSlaHours") or 24,
        "reminderPct": data.get("reminderPct") if data.get("reminderPct") is not None else 0,
        "warningPct": data.get("warningPct") if data.get("warningPct") is not None else 50,
        "escalationPct": data.get("escalationPct") if data.get("escalationPct") is not None else 75,
        "blockerPct": data.get("blockerPct") if data.get("blockerPct") is not None else 100,
        "channels": data.get("channels") or DEFAULT_ESCALATION_CHANNELS,
        "targets": data.get("targets") or {},
    }
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."escalation_configs" (
          "id", "activity_type", "activity_name", "description", "scope", "base_doc",
          "base_sla_hours", "reminder_pct", "warning_pct", "escalation_pct", "blocker_pct",
          "channels", "targets"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12::jsonb, $13::jsonb
        )
        """,
        config_id,
        activity_type,
        activity_name,
        str(current["description"]),
        scope,
        str(current["baseDoc"]),
        float(current["baseSlaHours"]),
        int(current["reminderPct"]),
        int(current["warningPct"]),
        int(current["escalationPct"]),
        int(current["blockerPct"]),
        json.dumps(current["channels"]),
        json.dumps(current["targets"]),
    )
    return {"ok": True, "data": current}


@router.put("/escalation/{config_id}")
@legacy_router.put("/escalation/{config_id}")
async def update_admin_escalation(config_id: str, request: EscalationConfigRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    current = await _get_escalation_config(prisma, config_id)
    if not current:
        return {"ok": False, "error": "Escalation config not found."}
    updates = request.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if value is not None:
            current[key] = value
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."escalation_configs"
        SET "activity_type" = $2,
            "activity_name" = $3,
            "description" = $4,
            "scope" = $5,
            "base_doc" = $6,
            "base_sla_hours" = $7,
            "reminder_pct" = $8,
            "warning_pct" = $9,
            "escalation_pct" = $10,
            "blocker_pct" = $11,
            "channels" = $12::jsonb,
            "targets" = $13::jsonb,
            "updated_at" = NOW()
        WHERE "id" = $1
        """,
        config_id,
        str(current["activityType"]),
        str(current["activityName"]),
        str(current.get("description") or ""),
        str(current.get("scope") or ""),
        str(current.get("baseDoc") or ""),
        float(current.get("baseSlaHours") or 24),
        int(current.get("reminderPct") or 0),
        int(current.get("warningPct") or 50),
        int(current.get("escalationPct") or 75),
        int(current.get("blockerPct") or 100),
        json.dumps(current.get("channels") or DEFAULT_ESCALATION_CHANNELS),
        json.dumps(current.get("targets") or {}),
    )
    return {"ok": True, "data": current}


@router.delete("/escalation/{config_id}")
@legacy_router.delete("/escalation/{config_id}")
async def delete_admin_escalation(config_id: str, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    current = await _get_escalation_config(prisma, config_id)
    if not current:
        return {"ok": False, "error": "Escalation config not found."}
    activity_type = str(current.get("activityType") or "")
    rows = await _query_raw(
        prisma,
        """
        SELECT COUNT(*) AS count
        FROM "public"."escalation_configs"
        WHERE "activity_type" = $1
        """,
        activity_type,
    )
    sibling_count = int(rows[0].get("count") or 0) if rows else 0
    if sibling_count <= 1:
        return {"ok": False, "error": "Each activity must have at least one escalation config."}
    await _execute_raw(
        prisma,
        """
        DELETE FROM "public"."escalation_configs"
        WHERE "id" = $1
        """,
        config_id,
    )
    return {"ok": True, "data": current}


@router.get("/partners")
@legacy_router.get("/partners")
async def list_admin_partners(_user=Depends(get_admin_user)):
    return {"ok": True, "data": []}


@router.get("/settings/team-overview")
@legacy_router.get("/settings/team-overview")
async def get_team_overview(_user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        users = _safe_keycloak_users(keycloak_admin)
        groups = _safe_keycloak_groups(keycloak_admin)
        active_users = [user for user in users if user.get("enabled", False)]
        admin_users = 0
        partner_users = 0
        override_users = 0
        for user in active_users:
            try:
                user = keycloak_admin.get_user(user["id"])
                assigned_roles = keycloak_admin.get_realm_roles_of_user(user["id"])
            except Exception:
                continue
            role_names = [str(role.get("name") or "") for role in assigned_roles]
            local_role = _local_role_from_keycloak_roles(role_names, str(user.get("email") or ""))
            if local_role in {"ADMIN", "SUPER_ADMIN"}:
                admin_users += 1
            attrs = _user_attrs(user)
            primary_role = _primary_role_name(role_names)
            role_category = "org_admin" if local_role in {"ADMIN", "SUPER_ADMIN"} else "org_internal"
            if primary_role:
                try:
                    role = keycloak_admin.get_realm_role(primary_role)
                    role_category = _attr_value(role.get("attributes") or {}, "ewms.category", role_category)
                except Exception:
                    pass
            if _is_external_access_user(attrs, role_category):
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
    prisma = await get_prisma()
    try:
        await prisma.execute_raw(
            """
            CREATE TABLE IF NOT EXISTS public.dnd_activity_audit (
              id TEXT PRIMARY KEY,
              action TEXT NOT NULL,
              description TEXT NOT NULL,
              entity_type TEXT,
              entity_id TEXT,
              user_id TEXT,
              metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        rows = await prisma.query_raw(
            """
            SELECT id, action, description, entity_type, entity_id, user_id, metadata, created_at
            FROM public.dnd_activity_audit
            ORDER BY created_at DESC
            LIMIT 100
            """
        )
        return {
            "ok": True,
            "data": [
                {
                    "id": str(row.get("id")),
                    "action": str(row.get("action") or ""),
                    "description": str(row.get("description") or ""),
                    "userName": str(row.get("user_id") or "system"),
                    "module": "dnd",
                    "entityType": row.get("entity_type"),
                    "entityId": row.get("entity_id"),
                    "createdAt": row.get("created_at").isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at") or ""),
                    "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
                }
                for row in rows
            ],
        }
    except Exception:
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
        return "SUPER_ADMIN"
    for role in roles:
        normalized = ROLE_ALIASES.get(str(role).lower(), str(role))
        if normalized == "Super Admin":
            return "SUPER_ADMIN"
        if normalized == "Org Admin":
            return "ADMIN"
    return "USER"


def _level_sort_value(level: Any) -> int:
    digits = "".join(ch for ch in str(level or "") if ch.isdigit())
    return int(digits or "1")


def _safe_keycloak_users(keycloak_admin, query: dict | None = None) -> list[dict]:
    query = query or {}
    try:
        return keycloak_admin.get_users(query) or []
    except TypeError:
        try:
            return keycloak_admin.get_users(**query) or []
        except TypeError:
            return keycloak_admin.get_users() or []


def _safe_keycloak_groups(keycloak_admin, query: dict | None = None) -> list[dict]:
    query = query or {}
    try:
        return keycloak_admin.get_groups(query) or []
    except TypeError:
        try:
            return keycloak_admin.get_groups(**query) or []
        except TypeError:
            return keycloak_admin.get_groups() or []


def _safe_realm_role_details(keycloak_admin, assigned_roles: list[dict]) -> list[dict]:
    roles: list[dict] = []
    for role in assigned_roles or []:
        name = str(role.get("name") or "").strip()
        if not name:
            continue
        try:
            roles.append(keycloak_admin.get_realm_role(name))
        except Exception:
            roles.append(role)
    return roles


def _safe_user_groups(keycloak_admin, user_id: str) -> list[dict]:
    try:
        return keycloak_admin.get_user_groups(user_id) or []
    except Exception:
        return []


def _clear_user_login_failures(keycloak_admin, user_id: str) -> None:
    for method_name in (
        "clear_user_login_failures",
        "clear_bruteforce_attempts_for_user",
        "clear_attack_detection_user",
    ):
        method = getattr(keycloak_admin, method_name, None)
        if not callable(method):
            continue
        try:
            method(user_id)
            return
        except TypeError:
            try:
                method(user_id=user_id)
                return
            except Exception:
                continue
        except Exception:
            continue


def _reset_keycloak_password_non_temporary(keycloak_admin, user_id: str, password: str) -> None:
    password_value = str(password or "")
    credential = {"type": "password", "value": password_value, "temporary": False}
    keycloak_admin.set_user_password(user_id, password_value, temporary=False)

    connection = getattr(keycloak_admin, "connection", None)
    raw_put = getattr(connection, "raw_put", None)
    if not callable(raw_put):
        return

    paths = [
        f"admin/realms/{settings.KEYCLOAK_REALM}/users/{user_id}/reset-password",
        f"/admin/realms/{settings.KEYCLOAK_REALM}/users/{user_id}/reset-password",
    ]
    for path in paths:
        try:
            raw_put(path, data=json.dumps(credential))
            return
        except TypeError:
            try:
                raw_put(path, data=json.dumps(credential), headers={"Content-Type": "application/json"})
                return
            except Exception:
                continue
        except Exception:
            continue


def _repair_keycloak_login_state(keycloak_admin, user_id: str, user_payload: dict[str, Any], *, activate: bool = True) -> dict[str, Any]:
    try:
        current = keycloak_admin.get_user(user_id) or {}
    except Exception:
        current = {}
    repaired = dict(current)
    repaired.update(user_payload or {})
    repaired["id"] = str(current.get("id") or user_id)
    repaired["username"] = str(repaired.get("username") or repaired.get("email") or "")
    repaired["email"] = str(repaired.get("email") or repaired.get("username") or "")
    repaired["enabled"] = True if activate else bool(repaired.get("enabled", True))
    repaired["emailVerified"] = True
    repaired["requiredActions"] = []
    repaired.pop("access", None)
    keycloak_admin.update_user(user_id, repaired)
    _clear_user_login_failures(keycloak_admin, user_id)
    try:
        refreshed = keycloak_admin.get_user(user_id) or repaired
    except Exception:
        refreshed = repaired
    remaining_actions = refreshed.get("requiredActions") or []
    if remaining_actions:
        refreshed = dict(refreshed)
        refreshed["requiredActions"] = []
        refreshed.pop("access", None)
        keycloak_admin.update_user(user_id, refreshed)
        try:
            refreshed = keycloak_admin.get_user(user_id) or refreshed
        except Exception:
            pass
    return dict(refreshed or repaired)


async def _safe_sync_local_user_from_keycloak(*, prisma, keycloak_user: dict, roles: list[dict]):
    if prisma is None:
        return None
    try:
        return await _sync_local_user_from_keycloak(
            prisma=prisma,
            keycloak_user=keycloak_user,
            roles=roles,
        )
    except Exception:
        return None


def _keycloak_user_name(user: dict) -> str:
    name_parts = []
    for part in ("firstName", "lastName"):
        value = str(user.get(part) or "").strip()
        if value and value != ".":
            name_parts.append(value)
    full_name = " ".join(name_parts).strip()
    attrs = user.get("attributes") or {}
    return (
        full_name
        or _attr_value(attrs, "fullName", "")
        or _attr_value(attrs, "name", "")
        or str(user.get("email") or user.get("username") or "")
    )


def _primary_role_name(role_names: list[str]) -> str:
    normalized = {ROLE_ALIASES.get(role.lower(), role): role for role in role_names}
    for role in ROLE_DEFAULTS:
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
    if "India Logistics" in normalized:
        return normalized["India Logistics"]
    return "India Logistics"


def _fallback_keycloak_user_row(user: dict, roles: list[dict], groups: list[dict] | None = None) -> dict:
    role_names = [str(role.get("name") or "") for role in roles or [] if role.get("name")]
    email = str(user.get("email") or user.get("username") or "").strip().lower()
    primary_role = _primary_role_name(role_names) if role_names else "India Logistics"
    canonical_role = _canonical_role_name(primary_role)
    defaults = ROLE_DEFAULTS.get(canonical_role, ROLE_DEFAULTS.get("India Logistics", {}))
    attrs = _user_attrs(user)
    team_id = _attr_value(attrs, "ewms.teamId", "")
    if not team_id and groups:
        team_id = str((groups[0] or {}).get("id") or "")
    display_name = str(defaults.get("name") or _display_role_name(primary_role))
    role_category = str(defaults.get("roleCategory") or _role_category(canonical_role))
    return {
        "id": str(user.get("id") or ""),
        "orgId": _attr_value(attrs, "ewms.orgId", "default-org"),
        "roleId": canonical_role if canonical_role in ROLE_DEFAULTS else primary_role,
        "email": email,
        "fullName": _keycloak_user_name(user) or email,
        "userType": _attr_value(attrs, "ewms.userType", "external" if role_category in {"org_external", "external", "EXTERNAL_PARTNER"} else "internal"),
        "status": "active" if user.get("enabled", False) else "inactive",
        "phone": _attr_value(attrs, "phone", ""),
        "level": _attr_value(attrs, "ewms.level", str((defaults.get("allowedLevels") or ["L1"])[-1])),
        "teamId": team_id,
        "dataScope": _normalize_data_scope(_attr_value(attrs, "ewms.dataScope", str(defaults.get("defaultDataScope") or "TEAM"))),
        "documentScope": _default_document_scope(canonical_role, defaults),
        "docTypeScopes": {},
        "geographyOrigin": _attr_value(attrs, "ewms.geographyOrigin", ""),
        "geographyDestination": _attr_value(attrs, "ewms.geographyDestination", ""),
        "approvalLimitInr": float(_attr_value(attrs, "ewms.approvalLimitInr", "0") or 0) or None,
        "approvalLimitUsd": float(_attr_value(attrs, "ewms.approvalLimitUsd", "0") or 0) or None,
        "createdAt": datetime.fromtimestamp((int(user.get("createdTimestamp") or 0) / 1000), timezone.utc).isoformat() if user.get("createdTimestamp") else None,
        "lastLoginAt": None,
        "keycloakRoles": role_names,
        "role": {
            "id": canonical_role if canonical_role in ROLE_DEFAULTS else primary_role,
            "name": display_name,
            "roleCategory": role_category,
        },
    }


def _keycloak_user_row(user: dict, roles: list[dict], groups: list[dict] | None = None) -> dict:
    role_names = [str(role.get("name")) for role in roles if role.get("name")]
    email = str(user.get("email") or user.get("username") or "").strip().lower()
    reference_user = REFERENCE_USER_DEFAULTS.get(email, {})
    primary_role = _primary_role_name(role_names)
    if reference_user:
        primary_role = str(reference_user["roleName"])
    canonical_role = _canonical_role_name(primary_role)
    primary_role_data = next(
        (
            role for role in roles
            if str(role.get("name") or "") == primary_role
            or _canonical_role_name(str(role.get("name") or "")) == canonical_role
        ),
        {},
    )
    role_attrs = primary_role_data.get("attributes") or {}
    role_defaults = ROLE_DEFAULTS.get(canonical_role, {})
    attrs = _user_attrs(user)
    team_id = _attr_value(attrs, "ewms.teamId", "")
    if not team_id and groups:
        team_id = str((groups[0] or {}).get("id") or "")
    role_levels = _attr_values(role_attrs, "ewms.levels") or list(role_defaults.get("allowedLevels", []))
    level = _attr_value(
        attrs,
        "ewms.level",
        str(reference_user.get("level") or sorted(role_levels or ["L1"], key=_level_sort_value)[-1]),
    )
    role_data_scope = _normalize_data_scope(_attr_value(role_attrs, "ewms.dataScope", str(role_defaults.get("defaultDataScope") or "TEAM")))
    data_scope = _normalize_data_scope(_attr_value(attrs, "ewms.dataScope", str(reference_user.get("dataScope") or role_data_scope)))
    doc_type_scopes = _parse_doc_type_scopes(role_attrs)
    document_scope = (
        _attr_values(role_attrs, "ewms.documentScope")
        or sorted({doc_type for doc_types in doc_type_scopes.values() for doc_type in doc_types})
        or _default_document_scope(canonical_role, role_defaults)
    )
    is_reference_role = canonical_role in ROLE_DEFAULTS
    role_category = str(role_defaults.get("roleCategory") or _role_category(canonical_role)) if is_reference_role else _attr_value(role_attrs, "ewms.category", _role_category(canonical_role))
    full_name = str(reference_user.get("fullName") or _keycloak_user_name(user))
    row_role_id = canonical_role if canonical_role in ROLE_DEFAULTS else primary_role
    role_display_name = str(role_defaults.get("name") or _display_role_name(primary_role)) if is_reference_role else _attr_value(role_attrs, "ewms.displayName", _display_role_name(primary_role))
    return {
        "id": str(user.get("id") or ""),
        "orgId": _attr_value(attrs, "ewms.orgId", "default-org"),
        "roleId": row_role_id,
        "email": email,
        "fullName": full_name,
        "userType": _attr_value(attrs, "ewms.userType", str(reference_user.get("userType") or ("external" if role_category in {"org_external", "external", "EXTERNAL_PARTNER"} else "internal"))),
        "status": "active" if user.get("enabled", False) else "inactive",
        "phone": _attr_value(attrs, "phone", ""),
        "level": level,
        "teamId": team_id,
        "dataScope": data_scope,
        "documentScope": document_scope,
        "docTypeScopes": doc_type_scopes,
        "geographyOrigin": _attr_value(attrs, "ewms.geographyOrigin", ""),
        "geographyDestination": _attr_value(attrs, "ewms.geographyDestination", ""),
        "approvalLimitInr": float(_attr_value(attrs, "ewms.approvalLimitInr", "0") or 0) or None,
        "approvalLimitUsd": float(_attr_value(attrs, "ewms.approvalLimitUsd", "0") or 0) or None,
        "createdAt": datetime.fromtimestamp((int(user.get("createdTimestamp") or 0) / 1000), timezone.utc).isoformat() if user.get("createdTimestamp") else None,
        "lastLoginAt": None,
        "keycloakRoles": role_names,
        "role": {
            "id": row_role_id,
            "name": role_display_name,
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
        users = _safe_keycloak_users(keycloak_admin)
        rows = []
        for keycloak_user in users:
            keycloak_user = keycloak_admin.get_user(keycloak_user["id"])
            assigned_roles = keycloak_admin.get_realm_roles_of_user(keycloak_user["id"])
            email = str(keycloak_user.get("email") or keycloak_user.get("username") or "").strip().lower()
            reference_user = REFERENCE_USER_DEFAULTS.get(email)
            if reference_user:
                expected_role = str(reference_user["roleName"])
                assigned_canonical_roles = {
                    _canonical_role_name(str(role.get("name") or ""))
                    for role in assigned_roles
                    if role.get("name")
                }
                if expected_role not in assigned_canonical_roles:
                    _assign_primary_role(keycloak_admin, keycloak_user["id"], expected_role)
                    assigned_roles = keycloak_admin.get_realm_roles_of_user(keycloak_user["id"])
            roles = _safe_realm_role_details(keycloak_admin, assigned_roles)
            groups = _safe_user_groups(keycloak_admin, keycloak_user["id"])
            await _safe_sync_local_user_from_keycloak(
                prisma=prisma,
                keycloak_user=keycloak_user,
                roles=roles,
            )
            try:
                rows.append(_keycloak_user_row(keycloak_user, roles, groups))
            except Exception:
                rows.append(_fallback_keycloak_user_row(keycloak_user, assigned_roles, groups))
        rows.sort(key=lambda item: item["email"].lower())
        return {"ok": True, "data": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync users from Keycloak: {exc}")


def _split_full_name(full_name: str) -> tuple[str, str]:
    cleaned = " ".join(str(full_name or "").strip().split())
    first_name, _, last_name = cleaned.partition(" ")
    if not first_name:
        first_name = cleaned or "User"
    if not last_name:
        last_name = "."
    return first_name, last_name


def _display_name_attributes(full_name: str, first_name: str, last_name: str) -> dict[str, list[str]]:
    display_name = " ".join(part for part in [first_name, "" if last_name == "." else last_name] if part).strip() or full_name or first_name
    return {
        "name": [display_name],
        "fullName": [display_name],
    }


def _assign_primary_role(keycloak_admin, user_id: str, role_name: str) -> None:
    selected_role = _ensure_keycloak_role(keycloak_admin, role_name)
    selected_role_name = str(selected_role.get("name") or role_name)
    existing_roles = keycloak_admin.get_realm_roles_of_user(user_id)
    removable = [
        role
        for role in existing_roles
        if role.get("name")
        and not str(role["name"]).startswith("default-roles-")
        and str(role["name"]) not in {"offline_access", "uma_authorization"}
        and str(role["name"]) != selected_role_name
    ]
    if removable:
        keycloak_admin.delete_realm_roles_of_user(user_id, removable)
    existing_role_names = {str(role.get("name")) for role in keycloak_admin.get_realm_roles_of_user(user_id)}
    if selected_role_name not in existing_role_names:
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
    initial_password = str(request.password or "").strip()
    if not initial_password:
        return {"ok": False, "error": "Initial password is required for new users."}
    keycloak_admin = get_keycloak_admin()
    prisma = await get_prisma()
    first_name, last_name = _split_full_name(full_name)
    try:
        user_id = keycloak_admin.get_user_id(email)
        attrs = _user_attributes_from_request(request)
        attrs.update(_display_name_attributes(full_name, first_name, last_name))
        payload = {
            "username": email,
            "email": email,
            "firstName": first_name,
            "lastName": last_name,
            "enabled": request.status != "inactive",
            "emailVerified": True,
            "requiredActions": [],
            "attributes": attrs,
        }
        if user_id:
            payload = _repair_keycloak_login_state(keycloak_admin, user_id, payload, activate=request.status != "inactive")
        else:
            user_id = keycloak_admin.create_user(
                {
                    **payload,
                    "credentials": [
                        {
                            "type": "password",
                            "value": initial_password,
                            "temporary": False,
                        }
                    ],
                },
                exist_ok=True,
            )
        _reset_keycloak_password_non_temporary(keycloak_admin, user_id, initial_password)
        _repair_keycloak_login_state(keycloak_admin, user_id, payload, activate=request.status != "inactive")
        _assign_primary_role(keycloak_admin, user_id, role_name)
        _sync_user_team(keycloak_admin, user_id, request.teamId)
        user = keycloak_admin.get_user(user_id)
        assigned_roles = keycloak_admin.get_realm_roles_of_user(user_id)
        roles = _safe_realm_role_details(keycloak_admin, assigned_roles)
        groups = _safe_user_groups(keycloak_admin, user_id)
        await _safe_sync_local_user_from_keycloak(prisma=prisma, keycloak_user=user, roles=roles)
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
        if request.password:
            enabled = True
        attrs = _user_attributes_from_request(request, existing)
        attrs.update(_display_name_attributes(full_name, first_name, last_name))
        payload = {
            "email": existing.get("email") or existing.get("username"),
            "username": existing.get("username") or existing.get("email"),
            "firstName": first_name,
            "lastName": last_name,
            "enabled": enabled,
            "emailVerified": True,
            "attributes": attrs,
        }
        if request.password:
            payload = _repair_keycloak_login_state(keycloak_admin, user_id, payload, activate=True)
        else:
            keycloak_admin.update_user(user_id, payload)
        if request.password:
            _reset_keycloak_password_non_temporary(keycloak_admin, user_id, request.password.strip())
            payload = _repair_keycloak_login_state(keycloak_admin, user_id, payload, activate=True)
        if request.roleId:
            _assign_primary_role(keycloak_admin, user_id, request.roleId)
        if request.teamId is not None:
            _sync_user_team(keycloak_admin, user_id, request.teamId)
        user = keycloak_admin.get_user(user_id)
        assigned_roles = keycloak_admin.get_realm_roles_of_user(user_id)
        roles = _safe_realm_role_details(keycloak_admin, assigned_roles)
        groups = _safe_user_groups(keycloak_admin, user_id)
        await _safe_sync_local_user_from_keycloak(prisma=prisma, keycloak_user=user, roles=roles)
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
        assigned_roles = keycloak_admin.get_realm_roles_of_user(user_id)
        roles = _safe_realm_role_details(keycloak_admin, assigned_roles)
        await _safe_sync_local_user_from_keycloak(prisma=prisma, keycloak_user={**existing, "enabled": False}, roles=roles)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not deactivate Keycloak user: {exc}")


@router.get("/roles")
@legacy_router.get("/roles")
async def list_admin_roles(_user=Depends(get_admin_user)):
    try:
        keycloak_admin = get_keycloak_admin()
        roles = keycloak_admin.get_realm_roles()
        users = _safe_keycloak_users(keycloak_admin)
        role_counts: dict[str, int] = {}
        for user in users:
            email = str(user.get("email") or user.get("username") or "").strip().lower()
            reference_user = REFERENCE_USER_DEFAULTS.get(email)
            if reference_user:
                role_name = str(reference_user["roleName"])
                role_counts[role_name] = role_counts.get(role_name, 0) + 1
                continue
            for role in keycloak_admin.get_realm_roles_of_user(user["id"]):
                name = str(role.get("name") or "")
                role_counts[name] = role_counts.get(name, 0) + 1
                canonical_name = _canonical_role_name(name)
                if canonical_name != name:
                    role_counts[canonical_name] = role_counts.get(canonical_name, 0) + 1
        filtered_roles = [
            role for role in roles
            if role.get("name") and not str(role["name"]).startswith("default-roles-")
            and str(role["name"]) not in {"offline_access", "uma_authorization"}
        ]
        role_rows_by_id: dict[str, dict[str, Any]] = {}
        role_row_priorities: dict[str, int] = {}
        seen_defaults: set[str] = set()
        for role in sorted(filtered_roles, key=lambda item: str(item.get("name", "")).lower()):
            role_name = str(role.get("name") or "")
            canonical_name = _canonical_role_name(role_name)
            if canonical_name in ROLE_DEFAULTS:
                seen_defaults.add(canonical_name)
            row = _role_profile_from_keycloak(
                role,
                user_count=role_counts.get(role_name, role_counts.get(canonical_name, 0)),
            )
            priority = _default_role_source_priority(role_name)
            existing_priority = role_row_priorities.get(row["id"], -1)
            if row["id"] not in role_rows_by_id or priority > existing_priority:
                role_rows_by_id[row["id"]] = row
                role_row_priorities[row["id"]] = priority
        for role_name, defaults in ROLE_DEFAULTS.items():
            if role_name in seen_defaults:
                continue
            row = _role_profile_from_keycloak(
                {
                    "name": role_name,
                    "description": defaults.get("description"),
                    "attributes": {},
                },
                user_count=role_counts.get(role_name, 0),
            )
            role_rows_by_id[row["id"]] = row
        return {
            "ok": True,
            "data": sorted(role_rows_by_id.values(), key=lambda item: list(ROLE_DEFAULTS).index(item["id"]) if item["id"] in ROLE_DEFAULTS else 999),
        }
    except Exception as exc:
        return {
            "ok": True,
            "data": [
                {
                    "id": role_name,
                    "name": defaults["name"],
                    "displayName": defaults["name"],
                    "description": defaults.get("description"),
                    "roleCategory": defaults["roleCategory"],
                    "profileCategory": defaults["roleCategory"],
                    "isSystemDefault": True,
                    "systemCode": ROLE_SYSTEM_CODES.get(role_name),
                    "color": defaults["color"],
                    "allowedLevels": defaults["allowedLevels"],
                    "defaultModules": defaults["defaultModules"],
                    "defaultDataScope": defaults["defaultDataScope"],
                    "_count": {"users": 0, "roleActivities": len(defaults.get("activityCodes", []))},
                }
                for role_name, defaults in ROLE_DEFAULTS.items()
            ],
            "warning": f"Could not sync roles from Keycloak: {exc}",
        }


@router.get("/roles/{role_id}")
@legacy_router.get("/roles/{role_id}")
async def get_admin_role(role_id: str, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        role = _ensure_keycloak_role(keycloak_admin, role_id)
        users = keycloak_admin.get_realm_role_members(str(role.get("name") or role_id))
        return {"ok": True, "data": _role_profile_from_keycloak(role, user_count=len(users or []), detail=True)}
    except Exception as exc:
        canonical_name = _canonical_role_name(role_id)
        if canonical_name in ROLE_DEFAULTS:
            defaults = ROLE_DEFAULTS[canonical_name]
            return {
                "ok": True,
                "data": _role_profile_from_keycloak(
                    {"name": canonical_name, "description": defaults.get("description"), "attributes": {}},
                    detail=True,
                ),
            }
        raise HTTPException(status_code=404, detail=f"Role not found in Keycloak: {exc}")


@router.post("/roles")
@legacy_router.post("/roles")
async def create_admin_role(request: RoleProfileRequest, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    modules = _enabled_modules_from_request(request)
    payload = _role_payload_from_request(request)
    if not modules and _canonical_role_name(request.name) not in {"Super Admin", "Org Admin"}:
        return {"ok": False, "error": "Select at least one module for this role."}
    activity_sla = _activity_sla_from_request(request)
    try:
        prisma = await get_prisma()
        await _upsert_activity_sla_configs(prisma, activity_sla)
        keycloak_admin.create_realm_role(payload, skip_exists=False)
        role = keycloak_admin.get_realm_role(payload["name"])
        return {"ok": True, "data": _role_profile_from_keycloak(role, detail=True)}
    except HTTPException:
        raise
    except Exception as exc:
        return {"ok": False, "error": f"Could not create Keycloak role: {exc}"}


@router.put("/roles/{role_id}")
@legacy_router.put("/roles/{role_id}")
async def update_admin_role(role_id: str, request: RoleProfileRequest, _user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        existing = _ensure_keycloak_role(keycloak_admin, role_id)
        update_role_name = str(existing.get("name") or role_id)
        if _canonical_role_name(role_id) in ROLE_DEFAULTS:
            payload = _role_payload_from_request(request, role_id=update_role_name)
            payload["name"] = update_role_name
        else:
            payload = _role_payload_from_request(request, role_id=update_role_name)
        if not _enabled_modules_from_request(request) and _canonical_role_name(update_role_name) not in {"Super Admin", "Org Admin"}:
            return {"ok": False, "error": "Select at least one module for this role."}
        activity_sla = _activity_sla_from_request(request)
        prisma = await get_prisma()
        await _upsert_activity_sla_configs(prisma, activity_sla)
        _update_keycloak_role(keycloak_admin, existing, payload)
        role = keycloak_admin.get_realm_role(update_role_name)
        return {"ok": True, "data": _role_profile_from_keycloak(role, detail=True)}
    except HTTPException:
        raise
    except Exception as exc:
        return {"ok": False, "error": f"Could not update Keycloak role {role_id!r}: {exc}"}


@router.delete("/roles/{role_id}")
@legacy_router.delete("/roles/{role_id}")
async def delete_admin_role(role_id: str, _user=Depends(get_admin_user)):
    if _canonical_role_name(role_id) in ROLE_DEFAULTS or role_id.lower() in {"admin", "user"}:
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
        role = _ensure_keycloak_role(keycloak_admin, role_name)
        role_name = str(role.get("name") or _canonical_role_name(role_name))
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
                            "value": request.password,
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
    if _role_value(local_role) in {"ADMIN", "SUPER_ADMIN"} and synced_user:
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

def _keycloak_server_url_candidates() -> list[str]:
    configured = f"{settings.KEYCLOAK_URL.rstrip('/')}/"
    candidates = [configured]
    if configured.rstrip('/').endswith('/keycloak'):
        candidates.append(f"{configured.rstrip('/')[:-len('/keycloak')]}/")
    else:
        candidates.append(f"{configured.rstrip('/')}/keycloak/")
    seen: set[str] = set()
    return [url for url in candidates if not (url in seen or seen.add(url))]


def _keycloak_admin_for_url(server_url: str) -> KeycloakAdmin:
    return KeycloakAdmin(
        server_url=server_url,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True,
    )


def get_keycloak_admin():
    """Get Keycloak admin client with production-safe URL normalization."""
    first_error: Exception | None = None
    for server_url in _keycloak_server_url_candidates():
        admin = _keycloak_admin_for_url(server_url)
        try:
            admin.get_realm(settings.KEYCLOAK_REALM)
            return admin
        except Exception as exc:
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error
    return _keycloak_admin_for_url(f"{settings.KEYCLOAK_URL.rstrip('/')}/")

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
