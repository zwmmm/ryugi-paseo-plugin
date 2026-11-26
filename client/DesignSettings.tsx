import { useRpc, useSubscription, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { runtimeUpdateStatus, startRuntimeUpdate, type RuntimeUpdateStatus } from "../shared/runtimeUpdate.js";
import { BrowserSettings } from "./BrowserSettings.js";
import { messages } from "./messages.js";
import { RemoteAccessSettings } from "./RemoteAccessSettings.js";

export function DesignSettings() {
  const { t } = useTranslation(messages);
  return (
    <>
      <SettingsSection title={t("settings.general")}>
        <SettingsCard>
          <RuntimeVersionSettings />
          <BrowserSettings />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("remote.title")}>
        <RemoteAccessSettings />
      </SettingsSection>
    </>
  );
}

function RuntimeVersionSettings() {
  const { t } = useTranslation(messages);
  const startUpdate = useRpc(startRuntimeUpdate);
  const [status, setStatus] = useState<RuntimeUpdateStatus>();
  const [requesting, setRequesting] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const subscription = useSubscription(runtimeUpdateStatus, {}, setStatus);
  const unavailable = subscription.status === "error" || subscription.status === "closed";
  const updating = requesting || status?.phase === "updating";
  const version = status ? t("runtime.version", { version: status.version }) : t("runtime.loading");
  const feedback = updating ? t("runtime.updating")
    : status?.phase === "updated" ? t("runtime.updated")
    : status?.phase === "current" ? t("runtime.current")
    : undefined;

  return (
    <SettingsAction
      label={t("runtime.title")}
      hint={feedback ? `${version}\n${feedback}` : version}
      actionLabel={t("runtime.update")}
      disabled={!status || updating || subscription.status !== "live"}
      error={unavailable ? t("runtime.unavailable")
        : requestFailed || status?.phase === "failed" ? t("runtime.failed")
        : undefined}
      onPress={async () => {
        setRequesting(true);
        setRequestFailed(false);
        try {
          await startUpdate({});
        } catch {
          setRequestFailed(true);
        } finally {
          setRequesting(false);
        }
      }}
    />
  );
}
