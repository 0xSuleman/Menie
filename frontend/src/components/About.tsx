import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import Image from "next/image";
import { UpdateDialog } from "./UpdateDialog";
import { updateService, UpdateInfo } from "@/services/updateService";
import { Button } from "./ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function About() {
  const [currentVersion, setCurrentVersion] = useState<string>("0.4.0");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  useEffect(() => {
    // Get current version on mount
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    try {
      const info = await updateService.checkForUpdates(true);
      setUpdateInfo(info);
      if (info.available) {
        setShowUpdateDialog(true);
      } else {
        toast.success("You are running the latest version");
      }
    } catch (error: any) {
      console.error("Failed to check for updates:", error);
      toast.error(
        "Failed to check for updates: " + (error.message || "Unknown error"),
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="p-4 space-y-4 h-[80vh] overflow-y-auto">
      {/* Compact Header */}
      <div className="brand-card rounded-2xl p-4 text-center">
        <div className="mb-3">
          <Image
            src="/menie-logo.png"
            alt="MENIE logo"
            width={64}
            height={64}
            className="mx-auto rounded-2xl shadow-sm"
          />
        </div>
        {/* <h1 className="text-xl font-bold text-gray-900">Menie</h1> */}
        <div className="font-brand text-sm text-blue-700">MENIE</div>
        <span className="text-xs text-gray-500">
          Your Meetings Genie · v{currentVersion}
        </span>
        <p className="text-medium text-gray-600 mt-1">
          MENIE — Your Meetings Genie. Local notes and summaries that never
          leave your machine.
        </p>
        <div className="mt-3">
          <Button
            onClick={handleCheckForUpdates}
            disabled={isChecking}
            variant="outline"
            size="sm"
            className="text-xs"
          >
            {isChecking ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 mr-2" />
                Check for Updates
              </>
            )}
          </Button>
          {updateInfo?.available && (
            <div className="mt-2 text-xs text-blue-600">
              Update available: v{updateInfo.version}
            </div>
          )}
        </div>
      </div>

      {/* Features Grid - Compact */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">
          What makes MENIE different
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="brand-card rounded-xl p-3 hover:-translate-y-0.5 transition-transform">
            <h3 className="font-bold text-sm text-gray-900 mb-1">
              Privacy-first
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Your data & AI processing workflow can now stay within your
              premise. No cloud, no leaks.
            </p>
          </div>
          <div className="brand-card rounded-xl p-3 hover:-translate-y-0.5 transition-transform">
            <h3 className="font-bold text-sm text-gray-900 mb-1">
              Use Any Model
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              MENIE is your local Meetings Genie: it captures, transcribes, and
              organizes conversations without sending your meeting content to
              the cloud.
            </p>
          </div>
          <div className="brand-card rounded-xl p-3 hover:-translate-y-0.5 transition-transform">
            <h3 className="font-bold text-sm text-gray-900 mb-1">
              Calm, Capable, Local
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              MENIE turns conversations into clear notes and next steps on your
              device—without subscriptions, cloud processing, or per-minute
              charges.
            </p>
          </div>
          <div className="brand-card rounded-xl p-3 hover:-translate-y-0.5 transition-transform">
            <h3 className="font-bold text-sm text-gray-900 mb-1">
              Desktop-friendly
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Zoom, Teams, Webex, Slack, and other desktop meeting apps;
              browser-based Meet requires manual recording mode.
            </p>
          </div>
        </div>
      </div>

      {/* Coming Soon - Compact */}
      <div className="brand-gradient rounded-xl p-4 text-white shadow-lg shadow-blue-200/50">
        <p className="text-sm text-white/95">
          <span className="font-bold">Local workflow tools:</span> grounded
          summaries, action review, follow-up drafts, and evidence search run on
          this device.
        </p>
      </div>

      {/* Update Dialog */}
      <UpdateDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        updateInfo={updateInfo}
      />
    </div>
  );
}
