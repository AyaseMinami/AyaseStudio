import { useRef, useState } from "react";
import { UserRound } from "lucide-react";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
import type { GeneralSettingsState } from "../../general/preferences";
import { AvatarLibraryPanel, AvatarModal } from "../avatar/AvatarLibrary";
import { SettingsHelp } from "./SettingsHelp";
import "./GeneralSettings.css";

export function GeneralSettings({ avatar, general }: { avatar?: UserAvatarState; general?: GeneralSettingsState }) {
  const [avatarDialog, setAvatarDialog] = useState<string>();
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const savingRef = useRef(false);
  const avatarBusy = libraryBusy || !!avatar?.busy;
  const unavailable = !general || !!general.error || saving;

  async function changePreference(key: "backgroundResident" | "confirmBeforeExit", value: boolean) {
    if (!general || general.error || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    try { if (!await general.setPreference(key, value)) setSaveError("常规设置保存失败，请重试。"); }
    catch { setSaveError("常规设置保存失败，请重试。"); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function closeAvatarDialog() {
    if (!avatarBusy) setAvatarDialog(undefined);
  }

  return <section className="settings-page general-settings-page" aria-labelledby="general-settings-title">
    <header className="settings-page-heading">
      <h2 id="general-settings-title">常规</h2>
      <p className="muted-text">按你的习惯调整应用的日常使用偏好。</p>
    </header>
    <div className="general-settings-groups">
      <section className="settings-card general-settings-group" aria-labelledby="general-profile-title">
        <h3 id="general-profile-title">个人资料</h3>
        <div className="general-profile">
          <div className={`general-avatar-preview${avatar?.url ? " general-avatar-image" : ""}`}>
            {avatar?.url ? <img src={avatar.url} width={64} height={64} alt="当前用户头像" /> : <UserRound size={32} strokeWidth={1.5} role="img" aria-label="默认用户头像" />}
          </div>
          <div className="general-profile-details">
            <div className="general-profile-label"><strong>用户头像</strong><SettingsHelp label="用户头像">所有对话共用此头像。图片和裁切结果仅保存在本机，不会上传或随消息发送。恢复默认不会删除头像库图片。</SettingsHelp></div>
            <p className="muted-text">{avatar?.url ? "当前使用自定义头像" : "当前使用默认头像"}</p>
            <div className="general-avatar-actions">
              <button type="button" className="settings-button" disabled={!avatar || avatarBusy} onClick={() => setAvatarDialog("更换头像")}>更换头像</button>
              <button type="button" className="settings-button" disabled={!avatar || avatarBusy} onClick={() => setAvatarDialog("管理头像库")}>管理头像库</button>
            </div>
          </div>
        </div>
        {avatar?.error && <p className="avatar-error" role="alert">{avatar.error}</p>}
      </section>
      <section className="settings-card general-settings-group" aria-labelledby="general-window-title">
        <h3 id="general-window-title">窗口与退出</h3>
        <div className="general-preference-row">
          <label htmlFor="general-background-resident">关闭窗口后在后台运行</label>
          <SettingsHelp label="关闭窗口后在后台运行">开启后，关闭窗口会隐藏到系统托盘，应用和任务继续运行。点击托盘图标或“打开 Ayase Studio”可恢复窗口；通过托盘菜单“退出”结束应用。关闭此选项后，关闭窗口将退出应用。</SettingsHelp>
          <input id="general-background-resident" className="ui-switch" type="checkbox" role="switch" checked={general?.preferences.backgroundResident ?? false} disabled={unavailable} onChange={(event) => void changePreference("backgroundResident", event.target.checked)} />
        </div>
        <div className="general-preference-row">
          <label htmlFor="general-confirm-exit">退出前确认</label>
          <SettingsHelp label="退出前确认">控制普通退出确认，不影响隐藏到托盘。关闭后，正在进行的绘图任务和未保存成果仍会显示各自的风险提示。</SettingsHelp>
          <input id="general-confirm-exit" className="ui-switch" type="checkbox" role="switch" checked={general?.preferences.confirmBeforeExit ?? false} disabled={unavailable} onChange={(event) => void changePreference("confirmBeforeExit", event.target.checked)} />
        </div>
        {!general && <p className="muted-text general-settings-unavailable">常规设置暂不可用。</p>}
        {(general?.error || saveError) && <p className="error-banner" role="alert">{general?.error || saveError}</p>}
      </section>
    </div>
    {avatarDialog && avatar && <AvatarModal title={avatarDialog} busy={avatarBusy} onClose={closeAvatarDialog}>
      <AvatarLibraryPanel avatar={avatar} initialManaging={avatarDialog === "管理头像库"} onBusyChange={setLibraryBusy} />
    </AvatarModal>}
  </section>;
}
