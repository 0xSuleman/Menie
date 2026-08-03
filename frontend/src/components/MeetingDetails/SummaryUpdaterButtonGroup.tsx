"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Copy,
  Save,
  Loader2,
  Search,
  FolderOpen,
  Download,
  Upload,
} from "lucide-react";
import Analytics from "@/lib/analytics";

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExportTranscript: (format: TranscriptExportFormat) => void;
  onImportBundle?: () => void;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

export type TranscriptExportFormat =
  | "txt"
  | "markdown"
  | "vtt"
  | "srt"
  | "json"
  | "bundle"
  | "secure-bundle"
  | "redacted-txt"
  | "redacted-markdown";

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onExportTranscript,
  onImportBundle,
  onFind,
  onOpenFolder,
  hasSummary,
}: SummaryUpdaterButtonGroupProps) {
  const [exportFormat, setExportFormat] =
    useState<TranscriptExportFormat>("markdown");
  return (
    <ButtonGroup>
      {/* Save button */}
      <Button
        variant="outline"
        size="sm"
        className={`${isDirty ? "bg-green-200" : ""}`}
        title={isSaving ? "Saving" : "Save Changes"}
        onClick={() => {
          Analytics.trackButtonClick("save_changes", "meeting_details");
          onSave();
        }}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="animate-spin" />
            <span className="hidden lg:inline">Saving...</span>
          </>
        ) : (
          <>
            <Save />
            <span className="hidden lg:inline">Save</span>
          </>
        )}
      </Button>

      <Button
        variant="outline"
        size="sm"
        title="Export Transcript as Markdown"
        onClick={() => {
          Analytics.trackButtonClick(
            `export_transcript_${exportFormat}`,
            "meeting_details",
          );
          onExportTranscript(exportFormat);
        }}
        className="cursor-pointer"
      >
        <Download />
        <span className="hidden lg:inline">Export</span>
      </Button>
      <select
        value={exportFormat}
        onChange={(event) =>
          setExportFormat(event.target.value as TranscriptExportFormat)
        }
        aria-label="Transcript export format"
        className="h-8 rounded-r-md border border-l-0 bg-white px-1 text-xs text-gray-700"
      >
        <option value="markdown">Markdown</option>
        <option value="txt">Text</option>
        <option value="redacted-markdown">Redacted Markdown</option>
        <option value="redacted-txt">Redacted text</option>
        <option value="vtt">VTT</option>
        <option value="srt">SRT</option>
        <option value="json">JSON</option>
        <option value="bundle">Meeting bundle (JSON)</option>
        <option value="secure-bundle">Encrypted handoff</option>
      </select>
      {onImportBundle && (
        <Button
          variant="outline"
          size="sm"
          title="Import local meeting bundle"
          onClick={onImportBundle}
        >
          <Upload />
          <span className="hidden lg:inline">Import</span>
        </Button>
      )}

      {/* Copy button */}
      <Button
        variant="outline"
        size="sm"
        title="Copy Summary"
        onClick={() => {
          Analytics.trackButtonClick("copy_summary", "meeting_details");
          onCopy();
        }}
        disabled={!hasSummary}
        className="cursor-pointer"
      >
        <Copy />
        <span className="hidden lg:inline">Copy</span>
      </Button>

      {/* Find button */}
      {onFind && (
        <Button
          variant="outline"
          size="sm"
          title="Find in Summary"
          onClick={() => {
            Analytics.trackButtonClick("find_in_summary", "meeting_details");
            onFind();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Search />
          <span className="hidden lg:inline">Find</span>
        </Button>
      )}
    </ButtonGroup>
  );
}
