import { useRpc, useSettings, useSubscription, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { remoteAccessSettings, remotePassword, startTunnelRpc, stopTunnelRpc, tunnelStatus } from "../shared/remoteAccess.js";
import { messages } from "./messages.js";

export function RemoteAccessSettings() {
  const settings = useSettings(remoteAccessSettings);
  const { t } = useTranslation(messages);
  const startTunnel = useRpc(startTunnelRpc);
  const stopTunnel = useRpc(stopTunnelRpc);
  const [active, setActive] = useState<boolean>();
  const [pending, setPending] = useState<"start" | "stop">();
  const [actionError, setActionError] = useState<"remote.startFailed" | "remote.stopFailed">();
  const subscription = useSubscription(tunnelStatus, {}, ({ active }) => setActive(active));
  const [draft, setDraft] = useState<{ password: string; revision: string }>();
  const attempted = useRef<typeof draft>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { save, saving } = settings;
  const saveError = settings.saveError ? t("settings.saveFailed") : undefined;
  const revision = settings.status === "ready" ? settings.revision : undefined;
  const savedPassword = settings.status === "ready" ? settings.values.password : undefined;
  const valid = !draft || remotePassword.safeParse(draft.password).success;

  useEffect(() => {
    clearTimeout(timer.current);
    if (!draft || !valid || revision === undefined || saving
      || draft === attempted.current || draft.password === savedPassword) return;

    // Let the final edit save even when the user immediately leaves this settings screen.
    timer.current = setTimeout(() => {
      attempted.current = draft;
      void save({ password: draft.password }, draft.revision).then((saved) => {
        if (saved) setDraft((current) => current === draft ? undefined : current);
      });
    }, 400);
  }, [draft, revision, save, savedPassword, saving, valid]);
  const loading = settings.status === "loading";
  if (!loading && settings.status !== "ready") {
    const invalid = settings.status === "invalid";
    return (
      <SettingsCard>
        <SettingsAction
          label={t("remote.password")}
          actionLabel={t(invalid ? "settings.reset" : "settings.retry")}
          error={saveError ?? t(invalid ? "settings.invalid" : "settings.loadFailed")}
          disabled={saving}
          onPress={invalid ? settings.reset : settings.reload}
        />
      </SettingsCard>
    );
  }
  const tunnelError = subscription.status === "error" || subscription.status === "closed";
  const passwordReady = Boolean(savedPassword) && !saving && (!draft || draft.password === savedPassword);
  const tunnelHint = pending === "start" ? "remote.startingTunnel"
    : pending === "stop" ? "remote.stoppingTunnel"
    : loading ? "settings.loading"
    : active === undefined ? "remote.checkingTunnel"
    : active ? "remote.tunnelActive"
    : !passwordReady ? "remote.passwordRequired"
    : "remote.tunnelIdle";
  const tunnelDisabled = loading || active === undefined || Boolean(pending) || tunnelError || (!active && !passwordReady);
  return (
    <SettingsCard>
      <SettingsInput
        key={settings.status}
        label={t("remote.password")}
        hint={t("remote.hint")}
        initialValue={savedPassword}
        error={valid ? saveError : t("remote.passwordTooLong")}
        disabled={loading || saving}
        onChangeText={(password) => {
          if (revision === undefined) return;
          setDraft((previous) => ({
            password,
            revision: previous && previous !== attempted.current ? previous.revision : revision,
          }));
        }}
        secureTextEntry
      />
      <SettingsAction
        label={t("remote.tunnel")}
        actionLabel={t(active ? "remote.stop" : "remote.start")}
        hint={tunnelError ? undefined : t(tunnelHint)}
        error={tunnelError ? t("remote.tunnelUnavailable") : actionError ? t(actionError) : undefined}
        disabled={tunnelDisabled}
        onPress={async () => {
          if (tunnelDisabled) return;
          setPending(active ? "stop" : "start");
          setActionError(undefined);
          try {
            if (active) await stopTunnel({});
            else await startTunnel({});
          } catch {
            setActionError(active ? "remote.stopFailed" : "remote.startFailed");
          } finally {
            setPending(undefined);
          }
        }}
      />
    </SettingsCard>
  );
}
