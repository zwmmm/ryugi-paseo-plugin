import { useRpc, useSettings, useSubscription, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { remoteAccessSettings, remotePassword, startTunnelRpc, stopTunnelRpc, tunnelStatus } from "../shared/remoteAccess.js";
import { messages } from "./messages.js";

export function RemoteAccessSettings({ theme }: PluginSurfaceProps) {
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
  if (settings.status === "loading") return <Text style={{ color: theme.colors.foreground }}>{t("remote.loading")}</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsCard>
        <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{settings.error}</Text>
        {settings.status === "invalid"
          ? <SettingsAction label={t("remote.title")} actionLabel={t("browser.reset")} disabled={settings.saving} onPress={settings.reset} />
          : <SettingsAction label={t("remote.title")} actionLabel={t("browser.reload")} onPress={settings.reload} />}
      </SettingsCard>
    );
  }
  const tunnelError = subscription.status === "error" || subscription.status === "closed";
  const passwordReady = Boolean(savedPassword) && !saving && (!draft || draft.password === savedPassword);
  const tunnelHint = pending === "start" ? "remote.startingTunnel"
    : pending === "stop" ? "remote.stoppingTunnel"
    : active === undefined ? "remote.checkingTunnel"
    : active ? "remote.tunnelActive"
    : !passwordReady ? "remote.passwordRequired"
    : "remote.tunnelIdle";
  return (
    <SettingsCard>
      <SettingsInput
        label={t("remote.password")}
        hint={t("remote.hint")}
        initialValue={settings.values.password}
        error={valid ? settings.saveError : t("remote.passwordTooLong")}
        disabled={saving}
        onChangeText={(password) => setDraft((previous) => ({
          password,
          revision: previous && previous !== attempted.current ? previous.revision : settings.revision,
        }))}
        secureTextEntry
      />
      <SettingsAction
        label={t("remote.tunnel")}
        actionLabel={t(active ? "remote.stop" : "remote.start")}
        hint={tunnelError ? undefined : t(tunnelHint)}
        error={tunnelError ? t("remote.tunnelUnavailable") : actionError ? t(actionError) : undefined}
        disabled={active === undefined || Boolean(pending) || tunnelError || (!active && !passwordReady)}
        onPress={async () => {
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
