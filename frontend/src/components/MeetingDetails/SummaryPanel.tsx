"use client";

import {
  Summary,
  SummaryDataResponse,
  SummaryDocument,
  SummaryResponse,
  Transcript,
} from "@/types";
import { EditableTitle } from "@/components/EditableTitle";
import {
  BlockNoteSummaryView,
  BlockNoteSummaryViewRef,
} from "@/components/AISummary/BlockNoteSummaryView";
import { EmptyStateSummary } from "@/components/EmptyStateSummary";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { SummaryGeneratorButtonGroup } from "./SummaryGeneratorButtonGroup";
import { SummaryUpdaterButtonGroup } from "./SummaryUpdaterButtonGroup";
import type { TranscriptExportFormat } from "./SummaryUpdaterButtonGroup";
import Analytics from "@/lib/analytics";
import { useEffect, useRef, useState, RefObject } from "react";
import { toast } from "sonner";
import { Languages, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { LanguagePickerPopover } from "@/components/LanguagePickerPopover";
import { MeetingEvidenceSearch } from "./MeetingEvidenceSearch";
import { TalkTimePanel } from "./TalkTimePanel";
import { WebhookDeliveryReview } from "./WebhookDeliveryReview";
import { CoachingPanel } from "./CoachingPanel";
import { AuditTrailPanel } from "./AuditTrailPanel";
import { CoachingTrendPanel } from "./CoachingTrendPanel";
import { useRecentLanguages } from "@/hooks/useRecentLanguages";
import { labelForCode } from "@/lib/summary-languages";
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from "@/lib/summary-language-preferences";

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
    project?: string;
    pinned_at?: string;
    archived_at?: string;
    trashed_at?: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onExportTranscript: (format: TranscriptExportFormat) => void;
  onImportBundle?: () => void;
  onOpenFolder: () => Promise<void>;
  aiSummary: SummaryDocument | null;
  summaryStatus:
    | "idle"
    | "processing"
    | "summarizing"
    | "regenerating"
    | "completed"
    | "error";
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (
    config: ModelConfig | ((prev: ModelConfig) => ModelConfig),
  ) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: SummaryDocument) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (
    status:
      | "idle"
      | "processing"
      | "summarizing"
      | "regenerating"
      | "completed"
      | "error",
  ) => string;
  availableTemplates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  onCitationClick?: (timestampSeconds: number) => void;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  onTitleChange,
  isEditingTitle,
  onStartEditTitle,
  onFinishEditTitle,
  isTitleDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onExportTranscript,
  onImportBundle,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
  onCitationClick,
}: SummaryPanelProps) {
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [project, setProject] = useState(meeting.project || "");
  const [retentionDays, setRetentionDays] = useState("");
  const [retentionStatus, setRetentionStatus] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [vocabularyInput, setVocabularyInput] = useState("");
  const [pinned, setPinned] = useState(Boolean(meeting.pinned_at));
  const [archived, setArchived] = useState(Boolean(meeting.archived_at));
  const [trashed, setTrashed] = useState(Boolean(meeting.trashed_at));
  const markdownSummary =
    aiSummary && "markdown" in aiSummary
      ? (aiSummary as SummaryDataResponse)
      : null;
  const structuredOutcomes = Array.isArray(markdownSummary?.outcomes)
    ? markdownSummary.outcomes
    : [];
  const actionItemsNeedingOwnerReview = structuredOutcomes.filter(
    (outcome) =>
      outcome.kind === "action_item" &&
      (outcome.evidence_status !== "linked" ||
        !outcome.owner ||
        /\b(owner|assigned to)\s*(is|:)?\s*(unassigned|tbd|unknown|none)\b/i.test(
          outcome.text,
        )),
  );
  const completionChecklist = {
    unassignedTasks: structuredOutcomes.filter(
      (outcome) => outcome.kind === "action_item" && !outcome.owner,
    ).length,
    ambiguousDates: structuredOutcomes.filter(
      (outcome) =>
        outcome.kind === "action_item" &&
        (!outcome.due ||
          /\b(tbd|unknown|unspecified|asap)\b/i.test(outcome.due)),
    ).length,
    unsupportedClaims: structuredOutcomes.filter(
      (outcome) => outcome.evidence_status !== "linked",
    ).length,
    failedArtifacts: summaryStatus === "error" ? 1 : 0,
    unsentFollowUps: structuredOutcomes.length > 0 ? 1 : 0,
  };
  const localFollowUpDraft =
    structuredOutcomes.length > 0
      ? [
          `Follow-up: ${meetingTitle || meeting.title}`,
          "",
          "Please review the following local meeting draft before sending it anywhere.",
          "",
          ...structuredOutcomes.map((outcome) => {
            const label = outcome.kind.replace(/_/g, " ");
            const metadata =
              outcome.kind === "action_item"
                ? ` — Owner: ${outcome.owner || "Needs review"}${outcome.due ? `; Due: ${outcome.due}` : ""}`
                : "";
            const evidence =
              outcome.evidence_status === "linked"
                ? " [local transcript evidence linked]"
                : " [evidence needs review]";
            return `- ${label}: ${outcome.text}${metadata}${evidence}`;
          }),
          "",
          "This draft was assembled locally from reviewed meeting outcomes. It has not been sent.",
        ].join("\n")
      : "";
  const localNextAgenda =
    structuredOutcomes.length > 0
      ? [
          `Next meeting agenda: ${meetingTitle || meeting.title}`,
          "",
          "1. Review open action items",
          ...structuredOutcomes
            .filter((outcome) => outcome.kind === "action_item")
            .map(
              (outcome) =>
                `- ${outcome.text}${outcome.owner ? ` (Owner: ${outcome.owner})` : " (Owner: assign)"}`,
            ),
          "2. Resolve open questions and blockers",
          ...structuredOutcomes
            .filter(
              (outcome) =>
                outcome.kind === "question" || outcome.kind === "blocker",
            )
            .map((outcome) => `- ${outcome.text}`),
          "3. Confirm decisions and next steps",
          ...structuredOutcomes
            .filter((outcome) => outcome.kind === "decision")
            .map((outcome) => `- ${outcome.text}`),
          "",
          "Generated locally from reviewed meeting outcomes. Verify against the transcript before use.",
        ].join("\\n")
      : "";
  const copyLocalNextAgenda = async () => {
    try {
      await navigator.clipboard.writeText(localNextAgenda);
      toast.success("Local next-meeting agenda copied. Review it before use.");
    } catch {
      toast.error("Could not copy the local next-meeting agenda.");
    }
  };
  const copyLocalFollowUpDraft = async () => {
    try {
      await navigator.clipboard.writeText(localFollowUpDraft);
      toast.success("Local follow-up draft copied. Review it before sending.");
    } catch {
      toast.error("Could not copy the local follow-up draft.");
    }
  };
  const isImportedRecording = transcripts.some(
    (transcript) => transcript.source === "import",
  );
  const [summaryLangStorage, setSummaryLangStorage] =
    useState<SummaryLanguageStorage>("metadata");
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
    rollback: {
      language: string | null;
      storage: SummaryLanguageStorage;
    };
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;

  useEffect(
    () => setProject(meeting.project || ""),
    [meeting.id, meeting.project],
  );
  useEffect(
    () => setPinned(Boolean(meeting.pinned_at)),
    [meeting.id, meeting.pinned_at],
  );
  useEffect(
    () => setArchived(Boolean(meeting.archived_at)),
    [meeting.id, meeting.archived_at],
  );
  useEffect(
    () => setTrashed(Boolean(meeting.trashed_at)),
    [meeting.id, meeting.trashed_at],
  );

  useEffect(() => {
    let cancelled = false;
    invoke<string | null>("api_get_meeting_retention", {
      meetingId: meeting.id,
    })
      .then((dueAt) => {
        if (cancelled) return;
        if (!dueAt) {
          setRetentionDays("");
          return;
        }
        const remaining = Math.max(
          1,
          Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000),
        );
        setRetentionDays(String(remaining));
      })
      .catch((error) =>
        console.error("Failed to load meeting retention:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  useEffect(() => {
    let cancelled = false;
    const scope = project.trim();
    setVocabulary([]);
    if (!scope) {
      void invoke("whisper_set_vocabulary", { terms: [] }).catch(
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
    }
    invoke<string[]>("api_get_project_vocabulary", { project: scope })
      .then((terms) => {
        if (cancelled) return;
        setVocabulary(terms);
        return invoke("whisper_set_vocabulary", { terms }).catch(
          () => undefined,
        );
      })
      .catch((error) => {
        console.error("Failed to load project vocabulary:", error);
        if (!cancelled) toast.error("Failed to load project vocabulary");
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setTags([]);
    invoke<string[]>("api_get_meeting_tags", { meetingId: meeting.id })
      .then((loadedTags) => {
        if (!cancelled) setTags(loadedTags);
      })
      .catch((error) => {
        console.error("Failed to load meeting tags:", error);
        if (!cancelled) toast.error("Failed to load meeting tags");
      });
    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const saveProject = async () => {
    try {
      await invoke("api_save_meeting_project", {
        meetingId: meeting.id,
        project: project.trim() || null,
      });
      toast.success(project.trim() ? "Project assigned" : "Project cleared");
    } catch (error) {
      console.error("Failed to save meeting project:", error);
      toast.error("Failed to save project");
    }
  };

  const saveRetention = async () => {
    const rawValue = retentionDays.trim();
    const days = rawValue ? Number(rawValue) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      setRetentionStatus(
        "Enter whole days from 1 to 3650, or clear to disable.",
      );
      return;
    }
    try {
      const dueAt = await invoke<string | null>("api_save_meeting_retention", {
        meetingId: meeting.id,
        days,
      });
      setRetentionStatus(
        dueAt
          ? `Will move to local Trash on ${new Date(dueAt).toLocaleDateString()}.`
          : "Retention schedule disabled.",
      );
    } catch (error) {
      setRetentionStatus(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const saveTags = async (nextTags: string[]) => {
    try {
      const savedTags = await invoke<string[]>("api_save_meeting_tags", {
        meetingId: meeting.id,
        tags: nextTags,
      });
      setTags(savedTags);
    } catch (error) {
      console.error("Failed to save meeting tags:", error);
      toast.error("Tags were not saved");
    }
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (
      tags.some(
        (existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      )
    ) {
      setTagInput("");
      return;
    }
    setTagInput("");
    void saveTags([...tags, tag]);
  };

  const saveVocabulary = async (nextTerms: string[]) => {
    if (!project.trim()) {
      toast.error("Assign a project before adding vocabulary");
      return;
    }
    try {
      const savedTerms = await invoke<string[]>("api_save_project_vocabulary", {
        meetingId: meeting.id,
        project: project.trim(),
        terms: nextTerms,
      });
      setVocabulary(savedTerms);
      await invoke("whisper_set_vocabulary", { terms: savedTerms }).catch(
        () => undefined,
      );
    } catch (error) {
      console.error("Failed to save project vocabulary:", error);
      toast.error("Project vocabulary was not saved");
    }
  };

  const addVocabularyTerm = () => {
    const term = vocabularyInput.trim();
    if (!term) return;
    if (
      vocabulary.some(
        (existing) => existing.toLocaleLowerCase() === term.toLocaleLowerCase(),
      )
    ) {
      setVocabularyInput("");
      return;
    }
    setVocabularyInput("");
    void saveVocabulary([...vocabulary, term]);
  };

  const generateSummaryWithVocabulary = (userPrompt: string) => {
    if (vocabulary.length === 0) return onGenerateSummary(userPrompt);
    const vocabularyHint = `Local project vocabulary (preserve these spellings when supported by the transcript evidence): ${vocabulary.join(", ")}.`;
    return onGenerateSummary(
      userPrompt.trim()
        ? `${userPrompt.trim()}\n\n${vocabularyHint}`
        : vocabularyHint,
    );
  };

  const setLifecycle = async (
    kind: "pinned" | "archived" | "trashed",
    enabled: boolean,
  ) => {
    try {
      await invoke(`api_set_meeting_${kind}`, {
        meetingId: meeting.id,
        [kind]: enabled,
      });
      if (kind === "pinned") setPinned(enabled);
      if (kind === "archived") setArchived(enabled);
      if (kind === "trashed") setTrashed(enabled);
      toast.success(
        enabled ? `Meeting ${kind}` : `Meeting ${kind} state cleared`,
      );
      window.dispatchEvent(new CustomEvent("meeting-lifecycle-changed"));
    } catch (error) {
      console.error(`Failed to update meeting ${kind}:`, error);
      toast.error(`Failed to update meeting ${kind}`);
    }
  };
  const { addRecent } = useRecentLanguages();

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : "Auto";
  const isLocalFallbackLanguage = summaryLangStorage === "local_fallback";
  const autoSubtitle = isLocalFallbackLanguage
    ? "Saved on this device for folderless meetings"
    : "Uses dominant transcript language";

  useEffect(() => {
    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
        }
      } catch (err) {
        console.error("Failed to load summary language:", err);
        toast.warning("Could not load saved summary language", {
          description: "Using Auto until meeting metadata can be read.",
        });
        if (!cancelled && languageLoadVersionRef.current === loadVersion)
          setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(
            request.meetingId,
            request.language,
          );
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (saved.storage === "local_fallback") {
              toast.info("Summary language saved on this device", {
                description:
                  "This meeting has no recording folder, so the preference cannot be written to meeting metadata.",
              });
            }
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error("Failed to persist summary language:", err);
            toast.error("Failed to save summary language");
            setSummaryLang(request.rollback.language);
            setSummaryLangStorage(request.rollback.storage);
            return;
          }

          console.warn("Ignoring failed stale summary language save:", err);
          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
    }
  };

  const handleLangChange = (code: string | null) => {
    const previous = summaryLang;
    const previousStorage = summaryLangStorage;
    const nextStored = code;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: nextStored,
      rollback: {
        language: previous,
        storage: previousStorage,
      },
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(nextStored);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const isSummaryLoading =
    summaryStatus === "processing" ||
    summaryStatus === "summarizing" ||
    summaryStatus === "regenerating";

  const languageSlot = (
    <Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={`Summary language: ${effectiveLangLabel}${isLocalFallbackLanguage ? " (saved on this device)" : ""}`}
          aria-label="Set summary language"
        >
          <Languages size={18} />
          <span className="hidden lg:inline">{effectiveLangLabel}</span>
          <ChevronDown size={14} className="text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 border-0 shadow-none bg-transparent"
      >
        <LanguagePickerPopover
          value={summaryLang}
          onChange={handleLangChange}
          onClose={() => setLangPickerOpen(false)}
          autoSubtitle={autoSubtitle}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        {isImportedRecording && (
          <p
            className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900"
            role="status"
          >
            Imported recording: this meeting was transcribed from a local audio
            file, not captured live by Menie.
          </p>
        )}
        <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">Project</span>
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            onBlur={() => void saveProject()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            placeholder="Add a local project or client"
            aria-label="Meeting project"
            className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm text-gray-800"
          />
        </label>
        <label className="mb-3 block text-sm text-gray-600">
          <span className="font-medium">Retention</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="3650"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
              onBlur={() => void saveRetention()}
              placeholder="Days"
              aria-label="Days until this meeting moves to Trash"
              className="w-24 rounded border border-gray-200 px-2 py-1 text-sm text-gray-800"
            />
            <span className="text-xs text-gray-500">
              Move to Trash after days (blank disables; never deletes).
            </span>
          </div>
          {retentionStatus && (
            <span role="status" className="mt-1 block text-xs text-gray-500">
              {retentionStatus}
            </span>
          )}
        </label>
        <div className="mb-3" aria-label="Meeting tags">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm font-medium text-gray-600">Tags</span>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  void saveTags(tags.filter((existing) => existing !== tag))
                }
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                aria-label={`Remove tag ${tag}`}
                title="Remove tag"
              >
                {tag} ×
              </button>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag();
              }
            }}
            maxLength={48}
            placeholder="Add local tag, then Enter"
            aria-label="Add meeting tag"
            className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-gray-800"
          />
        </div>
        <div className="mb-3" aria-label="Project vocabulary">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm font-medium text-gray-600">
              Project vocabulary
            </span>
            {vocabulary.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() =>
                  void saveVocabulary(
                    vocabulary.filter((existing) => existing !== term),
                  )
                }
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 hover:bg-indigo-100"
                aria-label={`Remove vocabulary term ${term}`}
                title="Remove term"
              >
                {term} ×
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={vocabularyInput}
              onChange={(event) => setVocabularyInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addVocabularyTerm();
                }
              }}
              placeholder={
                project.trim()
                  ? "Add name, acronym, or term"
                  : "Assign a project to add vocabulary"
              }
              disabled={!project.trim()}
              aria-label="Add project vocabulary term"
              className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-50"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addVocabularyTerm}
              disabled={!project.trim()}
            >
              Add
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Stored locally for this project. Decoder-hint application is shown
            when a local transcription model supports it.
          </p>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setLifecycle("pinned", !pinned)}
          >
            {pinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setLifecycle("archived", !archived)}
          >
            {archived ? "Restore from archive" : "Archive"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setLifecycle("trashed", !trashed)}
          >
            {trashed ? "Restore from trash" : "Move to trash"}
          </Button>
        </div>
        <MeetingEvidenceSearch
          meetingId={meeting.id}
          project={meeting.project}
          onCitationClick={onCitationClick}
        />
        <TalkTimePanel meetingId={meeting.id} />
        <CoachingPanel meetingId={meeting.id} />
        <CoachingTrendPanel project={meeting.project} />
        <WebhookDeliveryReview meetingId={meeting.id} />
        <AuditTrailPanel meetingId={meeting.id} />
        {/* <EditableTitle
          title={meetingTitle}
          isEditing={isEditingTitle}
          onStartEditing={onStartEditTitle}
          onFinishEditing={onFinishEditTitle}
          onChange={onTitleChange}
        /> */}

        {/* Button groups - only show when summary exists */}
        {aiSummary && !isSummaryLoading && (
          <div className="space-y-2">
            <div className="flex items-center justify-center w-full pt-0 gap-2">
              {/* Left-aligned: Summary Generator Button Group */}
              <div className="flex-shrink-0">
                <SummaryGeneratorButtonGroup
                  modelConfig={modelConfig}
                  setModelConfig={setModelConfig}
                  onSaveModelConfig={onSaveModelConfig}
                  onGenerateSummary={generateSummaryWithVocabulary}
                  onStopGeneration={onStopGeneration}
                  customPrompt={customPrompt}
                  summaryStatus={summaryStatus}
                  availableTemplates={availableTemplates}
                  selectedTemplate={selectedTemplate}
                  onTemplateSelect={onTemplateSelect}
                  hasTranscripts={transcripts.length > 0}
                  hasSummary={!!aiSummary}
                  isModelConfigLoading={isModelConfigLoading}
                  onOpenModelSettings={onOpenModelSettings}
                  languageSlot={languageSlot}
                />
              </div>

              {/* Right-aligned: Summary Updater Button Group */}
              <div className="flex-shrink-0">
                <SummaryUpdaterButtonGroup
                  isSaving={isSaving}
                  isDirty={isTitleDirty || summaryRef.current?.isDirty || false}
                  onSave={onSaveAll}
                  onCopy={onCopySummary}
                  onExportTranscript={onExportTranscript}
                  onImportBundle={onImportBundle}
                  onFind={() => {
                    const query = window.prompt("Find in summary", "");
                    if (!query?.trim()) return;
                    const findInPage = (
                      window as Window & {
                        find?: (
                          text: string,
                          caseSensitive?: boolean,
                          backwards?: boolean,
                          wrapAround?: boolean,
                        ) => boolean;
                      }
                    ).find;
                    if (
                      findInPage &&
                      !findInPage.call(window, query.trim(), false, false, true)
                    ) {
                      toast.info("That text was not found in the summary.");
                    }
                  }}
                  onOpenFolder={onOpenFolder}
                  hasSummary={!!aiSummary}
                />
              </div>
            </div>
            <p
              className="mx-auto max-w-2xl text-center text-xs text-amber-800"
              role="status"
            >
              Decisions, action items, risks, and questions are AI-generated
              drafts. Review them against the transcript before relying on or
              exporting them; timestamp evidence is shown only when available.
            </p>
            {structuredOutcomes.length > 0 && (
              <div className="mx-auto max-w-2xl rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <h3 className="font-semibold text-amber-950">Outcome review</h3>{" "}
                <div
                  className="mt-2 rounded border border-amber-300 bg-white/70 p-2 text-xs text-amber-950"
                  role="status"
                >
                  <p className="font-medium">Completion checklist</p>
                  <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                    <li>
                      {completionChecklist.unassignedTasks
                        ? `Needs owner: ${completionChecklist.unassignedTasks}`
                        : "✓ All action items have explicit owners"}
                    </li>
                    <li>
                      {completionChecklist.ambiguousDates
                        ? `Ambiguous dates: ${completionChecklist.ambiguousDates}`
                        : "✓ No ambiguous action dates detected"}
                    </li>
                    <li>
                      {completionChecklist.unsupportedClaims
                        ? `Evidence review: ${completionChecklist.unsupportedClaims}`
                        : "✓ All outcomes have linked evidence"}
                    </li>
                    <li>
                      {completionChecklist.failedArtifacts
                        ? "Summary artifact failed — retry required"
                        : "✓ Summary artifact completed"}
                    </li>
                    <li>
                      {completionChecklist.unsentFollowUps
                        ? "Follow-up draft is unsent and requires review"
                        : "No follow-up draft generated"}
                    </li>
                  </ul>
                </div>
                {actionItemsNeedingOwnerReview.length > 0 && (
                  <p
                    className="mt-2 rounded border border-amber-300 bg-white/60 px-2 py-1 text-xs text-amber-950"
                    role="status"
                  >
                    {actionItemsNeedingOwnerReview.length} action item
                    {actionItemsNeedingOwnerReview.length === 1 ? "" : "s"} need
                    owner/evidence review before follow-up. This is a local
                    heuristic, not a confirmed assignment.
                  </p>
                )}
                <ul className="mt-2 space-y-1.5">
                  {structuredOutcomes.map((outcome, index) => {
                    const timestamp = outcome.evidence_timestamps?.[0];
                    const label = outcome.kind.replace(/_/g, " ");
                    return (
                      <li
                        key={`${outcome.kind}-${index}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-amber-950"
                      >
                        <span className="font-medium capitalize">{label}:</span>
                        <span>{outcome.text}</span>
                        {outcome.kind === "action_item" && (
                          <span className="text-xs text-amber-800">
                            Owner: {outcome.owner || "Needs review"}
                            {outcome.due ? ` · Due: ${outcome.due}` : ""}
                          </span>
                        )}
                        {outcome.evidence_status === "linked" &&
                        typeof timestamp === "number" ? (
                          <span className="text-xs font-medium text-emerald-800">
                            Evidence {Math.floor(timestamp / 60)}:
                            {Math.floor(timestamp % 60)
                              .toString()
                              .padStart(2, "0")}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-700">
                            Evidence not linked
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 rounded border border-amber-300 bg-white/70 p-2">
                  <p className="text-xs text-amber-950">
                    Local follow-up draft: generated deterministically from
                    these reviewable outcomes. It is not sent anywhere.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyLocalFollowUpDraft()}
                    className="mt-2 rounded border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100"
                  >
                    Copy follow-up draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyLocalNextAgenda()}
                    className="mt-2 ml-2 rounded border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100"
                  >
                    Copy next-meeting agenda
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isSummaryLoading ? (
        <div className="flex flex-col h-full">
          {/* Show button group during generation */}
          <div className="flex items-center justify-center pt-8 pb-4">
            <SummaryGeneratorButtonGroup
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={onSaveModelConfig}
              onGenerateSummary={generateSummaryWithVocabulary}
              onStopGeneration={onStopGeneration}
              customPrompt={customPrompt}
              summaryStatus={summaryStatus}
              availableTemplates={availableTemplates}
              selectedTemplate={selectedTemplate}
              onTemplateSelect={onTemplateSelect}
              hasTranscripts={transcripts.length > 0}
              isModelConfigLoading={isModelConfigLoading}
              onOpenModelSettings={onOpenModelSettings}
            />
          </div>
          {/* Loading spinner */}
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-gray-600">Generating AI Summary...</p>
            </div>
          </div>
        </div>
      ) : !aiSummary ? (
        <div className="flex flex-col h-full">
          {/* Centered Summary Generator Button Group when no summary */}
          <div className="flex items-center justify-center gap-2 pt-8 pb-4">
            <SummaryGeneratorButtonGroup
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={onSaveModelConfig}
              onGenerateSummary={generateSummaryWithVocabulary}
              onStopGeneration={onStopGeneration}
              customPrompt={customPrompt}
              summaryStatus={summaryStatus}
              availableTemplates={availableTemplates}
              selectedTemplate={selectedTemplate}
              onTemplateSelect={onTemplateSelect}
              hasTranscripts={transcripts.length > 0}
              hasSummary={false}
              isModelConfigLoading={isModelConfigLoading}
              onOpenModelSettings={onOpenModelSettings}
              languageSlot={transcripts.length > 0 ? languageSlot : undefined}
            />
          </div>
          {/* Empty state message */}
          <EmptyStateSummary
            onGenerate={() => generateSummaryWithVocabulary(customPrompt)}
            hasModel={
              modelConfig.provider !== null && modelConfig.model !== null
            }
            isGenerating={isSummaryLoading}
          />
        </div>
      ) : (
        transcripts?.length > 0 && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {summaryResponse && (
              <div className="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-4 max-h-1/3 overflow-y-auto">
                <h3 className="text-lg font-semibold mb-2">Meeting Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <h4 className="font-medium mb-1">Key Points</h4>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.key_points.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                    <h4 className="font-medium mb-1">Action Items</h4>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.action_items.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                    <h4 className="font-medium mb-1">Decisions</h4>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.decisions.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                    <h4 className="font-medium mb-1">Main Topics</h4>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.main_topics.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                </div>
                {summaryResponse.raw_summary ? (
                  <div className="mt-4">
                    <h4 className="font-medium mb-1">Full Summary</h4>
                    <p className="text-sm whitespace-pre-wrap">
                      {summaryResponse.raw_summary}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
            <div className="p-6 w-full">
              <BlockNoteSummaryView
                ref={summaryRef}
                summaryData={aiSummary}
                onSave={onSaveSummary}
                onSummaryChange={onSummaryChange}
                onDirtyChange={onDirtyChange}
                status={summaryStatus}
                error={summaryError}
                onRegenerateSummary={() => {
                  Analytics.trackButtonClick(
                    "regenerate_summary",
                    "meeting_details",
                  );
                  onRegenerateSummary();
                }}
                meeting={{
                  id: meeting.id,
                  title: meetingTitle,
                  created_at: meeting.created_at,
                }}
              />
            </div>
            {summaryStatus !== "idle" && (
              <div
                className={`mt-4 p-4 rounded-lg ${
                  summaryStatus === "error"
                    ? "bg-red-100 text-red-700"
                    : summaryStatus === "completed"
                      ? "bg-green-100 text-green-700"
                      : "bg-blue-100 text-blue-700"
                }`}
              >
                <p className="text-sm font-medium">
                  {getSummaryStatusMessage(summaryStatus)}
                </p>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
