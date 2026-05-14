import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

ModuleRegistry.registerModules([AllCommunityModule]);

interface AgGridTableProps {
  columnDefs: ColDef[];
  rowData: Record<string, unknown>[];
  height?: number;
  defaultColDef?: ColDef;
  context?: Record<string, unknown>;
  rowHeight?: number;
}

export default function AgGridTable({
  columnDefs,
  rowData,
  height = 380,
  defaultColDef: defaultColDefOverride,
  context,
  rowHeight = 48,
}: AgGridTableProps) {
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      flex: 1,
      minWidth: 80,
      ...defaultColDefOverride,
    }),
    [defaultColDefOverride]
  );

  return (
    <div
      className="ag-theme-alpine rounded-lg overflow-hidden border border-border"
      style={{ height }}
    >
      <AgGridReact
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        animateRows={true}
        theme="legacy"
        context={context}
        rowHeight={rowHeight}
        rowSelection={{ mode: "multiRow" }}
        suppressMovableColumns={false}
      />
    </div>
  );
}
