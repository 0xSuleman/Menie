import React, { useEffect, useState } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OnboardingContainer } from "../OnboardingContainer";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SetupOverviewStep() {
  const { goNext, selectedSummaryModel, setSelectedSummaryModel } =
    useOnboarding();
  const router = useRouter();
  const [isMac, setIsMac] = useState(false);
  const [sampleMeetingState, setSampleMeetingState] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const [profiles, setProfiles] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      minimum_memory_gb: number;
      recommended: boolean;
      recommendation_reason: string;
    }>
  >([]);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import("@tauri-apps/plugin-os");
        setIsMac(platform() === "macos");
      } catch (e) {
        setIsMac(navigator.userAgent.includes("Mac"));
      }
    };
    checkPlatform();
    invoke<typeof profiles>("get_local_model_profiles")
      .then((availableProfiles) => {
        setProfiles(availableProfiles);
        const recommended = availableProfiles.find(
          (profile) => profile.recommended,
        );
        if (recommended && !selectedSummaryModel) {
          setSelectedSummaryModel(recommended.id);
        }
      })
      .catch((error) =>
        console.error("Failed to load local model profiles:", error),
      );
  }, [selectedSummaryModel, setSelectedSummaryModel]);

  const steps = [
    {
      number: 1,
      type: "transcription",
      title: "Download Transcription Engine",
    },
    {
      number: 2,
      type: "summarization",
      title: "Download Summarization Engine",
    },
  ];

  const handleContinue = () => {
    goNext();
  };

  const handleCreateSampleMeeting = async () => {
    setSampleMeetingState("creating");
    try {
      const result = await invoke<{ meeting_id: string }>(
        "api_create_local_sample_meeting",
      );
      router.push(
        `/meeting-details?id=${encodeURIComponent(result.meeting_id)}`,
      );
    } catch (error) {
      console.error("Could not create local sample meeting:", error);
      setSampleMeetingState("error");
    }
  };

  return (
    <OnboardingContainer
      title="SETUP YOUR GENIE"
      description="Choose the local intelligence profile that fits your device. Your meeting data stays right here."
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Steps Card */}
        <div className="brand-card w-full max-w-md rounded-3xl p-5 shadow-lg shadow-blue-100/50">
          <div className="space-y-4">
            {steps.map((step, idx) => {
              return (
                <div key={step.number} className={`flex items-start gap-4 p-1`}>
                  <div className="flex-1 ml-1">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      Step {step.number} : {step.title}
                      {step.type === "summarization" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="text-gray-400 hover:text-gray-600">
                                <Info className="w-4 h-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-sm">
                              Menie uses a packaged local model for summaries.
                              Your meeting audio, transcript, prompts, and
                              generated notes stay on this device.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <section
          className="w-full max-w-md space-y-3"
          aria-labelledby="local-model-heading"
        >
          <div>
            <h3 id="local-model-heading" className="font-medium text-gray-900">
              Choose a local AI profile
            </h3>
            <p className="text-sm text-gray-600">
              You can change this later. Menie recommends one based on local
              hardware only.
            </p>
          </div>
          {profiles.map((profile) => {
            const selected = selectedSummaryModel === profile.id;
            return (
              <button
                type="button"
                key={profile.id}
                onClick={() => setSelectedSummaryModel(profile.id)}
                className={`brand-card w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${selected ? "border-blue-500 bg-blue-50/70 ring-2 ring-cyan-200" : "border-blue-100 hover:border-blue-300"}`}
                aria-pressed={selected}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-900">
                    {profile.name}
                  </span>
                  {profile.recommended && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                      <CheckCircle2 className="h-4 w-4" /> Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {profile.description} Requires about{" "}
                  {profile.minimum_memory_gb} GB RAM.
                </p>
                {profile.recommended && (
                  <p className="mt-2 text-xs text-gray-700">
                    {profile.recommendation_reason}
                  </p>
                )}
              </button>
            );
          })}
        </section>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-4">
          <Button
            onClick={handleContinue}
            className="brand-gradient brand-glow w-full h-11 text-white hover:scale-[1.02] transition-transform"
          >
            Let's Go
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCreateSampleMeeting}
            disabled={sampleMeetingState === "creating"}
            className="w-full h-11"
          >
            {sampleMeetingState === "creating"
              ? "Creating local sample…"
              : "Explore a local sample meeting"}
          </Button>
          <p className="text-center text-xs text-gray-600">
            Includes a timestamped transcript for trying local search, evidence,
            and exports. It never uses your microphone, a model, or the network.
          </p>
          {sampleMeetingState === "error" && (
            <p className="text-center text-xs text-red-700" role="alert">
              The local sample could not be created. Your recordings and
              settings were not changed.
            </p>
          )}
          <div className="text-center">
            <a
              href="https://github.com/0xSuleman/Menie"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:underline"
            >
              Report issues on GitHub
            </a>
          </div>
        </div>
      </div>
    </OnboardingContainer>
  );
}
