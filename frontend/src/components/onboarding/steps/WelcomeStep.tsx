import React from "react";
import { Lock, Sparkles, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingContainer } from "../OnboardingContainer";
import { useOnboarding } from "@/contexts/OnboardingContext";

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    {
      icon: Lock,
      title: "Your data never leaves your device",
    },
    {
      icon: Sparkles,
      title: "Intelligent summaries & insights",
    },
    {
      icon: Cpu,
      title: "Works offline, no cloud required",
    },
  ];

  return (
    <OnboardingContainer
      title="WELCOME TO MENIE"
      description="Your Meetings Genie for clear notes, decisions, and next steps—kept on your device."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-10">
        <div className="brand-gradient h-1 w-20 rounded-full" />

        {/* Features Card */}
        <div className="brand-card w-full max-w-md rounded-3xl p-6 shadow-lg shadow-blue-100/60 space-y-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-blue-700" />
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {feature.title}
                </p>
              </div>
            );
          })}
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-3">
          <Button
            onClick={goNext}
            className="brand-gradient brand-glow w-full h-11 text-white hover:scale-[1.02] transition-transform"
          >
            Get Started
          </Button>
          <p className="text-xs text-center text-gray-500">
            Takes less than 3 minutes
          </p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
