import DriveSyncCard from "../components/DriveSyncCard";
import AboutSection from "../components/settings/AboutSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import ExcalidrawSettingsSection from "../components/settings/ExcalidrawSettingsSection";
import DataSection from "../components/settings/DataSection";
import ModelManagerSection from "../components/settings/ModelManagerSection";
import PlaybackSection from "../components/settings/PlaybackSection";
import PromptsEditor from "../components/settings/PromptsEditor";
import SpeechSection from "../components/settings/SpeechSection";

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-text-3">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface p-4 sm:p-5">
        {children}
      </div>
    </section>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-7 px-6 pt-7 sm:pt-9 pb-28 bg-base min-h-full">
      <h1 className="text-2xl font-bold tracking-tight text-text">Settings</h1>

      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <Group title="Speech">
          <SpeechSection />
        </Group>
        <Group title="Prompts">
          <PromptsEditor />
        </Group>
        <Group title="Local models">
          <ModelManagerSection />
        </Group>
        <Group title="Excalidraw & Stylus">
          <ExcalidrawSettingsSection />
        </Group>
        <div className="lg:col-span-2">
          <Group title="Sync">
            <DriveSyncCard />
          </Group>
        </div>
        <Group title="Playback">
          <PlaybackSection />
        </Group>
        <Group title="Appearance">
          <AppearanceSection />
        </Group>
        <div className="lg:col-span-2">
          <Group title="Data">
            <DataSection />
          </Group>
        </div>
        <div className="lg:col-span-2">
          <Group title="About">
            <AboutSection />
          </Group>
        </div>
      </div>
    </div>
  );
}
