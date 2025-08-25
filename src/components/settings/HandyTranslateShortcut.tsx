import React, { useEffect, useState, useRef } from "react";
import { type } from "@tauri-apps/plugin-os";
import {
  getKeyName,
  formatKeyCombination,
  normalizeKey,
  type OSType,
} from "../../lib/utils/keyboard";
import { ResetButton } from "../ui/ResetButton";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

interface HandyTranslateShortcutProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const HandyTranslateShortcut: React.FC<HandyTranslateShortcutProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { getSetting, updateBinding, resetBinding, isUpdating, isLoading } =
    useSettings();
  const [keyPressed, setKeyPressed] = useState<string[]>([]);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(
    null,
  );
  const [originalBinding, setOriginalBinding] = useState<string>("");
  const [osType, setOsType] = useState<OSType>("unknown");
  const shortcutRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const bindings = getSetting("bindings") || {};

  // Detect and store OS type
  useEffect(() => {
    const detectOsType = async () => {
      try {
        const detectedType = type();
        let normalizedType: OSType;

        switch (detectedType) {
          case "macos":
            normalizedType = "macos";
            break;
          case "windows":
            normalizedType = "windows";
            break;
          case "linux":
            normalizedType = "linux";
            break;
          default:
            normalizedType = "unknown";
        }

        setOsType(normalizedType);
      } catch (error) {
        console.error("Error detecting OS type:", error);
        setOsType("unknown");
      }
    };

    detectOsType();
  }, []);

  useEffect(() => {
    // Only add event listeners when we're in editing mode
    if (editingShortcutId === null) return;

    let cleanup = false;

    // Keyboard event listeners
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (cleanup) return;
      if (e.repeat) return; // ignore auto-repeat
      if (e.key === "Escape") {
        // Cancel recording and restore original binding
        if (editingShortcutId && originalBinding) {
          try {
            await updateBinding(editingShortcutId, originalBinding);
            await invoke("resume_binding", { id: editingShortcutId }).catch(
              console.error,
            );
          } catch (error) {
            console.error("Failed to restore original binding:", error);
            toast.error("Failed to restore original shortcut");
          }
        } else if (editingShortcutId) {
          await invoke("resume_binding", { id: editingShortcutId }).catch(
            console.error,
          );
        }
        setEditingShortcutId(null);
        setKeyPressed([]);
        setRecordedKeys([]);
        setOriginalBinding("");
        return;
      }
      e.preventDefault();

      // Get the key with OS-specific naming and normalize it
      const rawKey = getKeyName(e, osType);
      const key = normalizeKey(rawKey);

      if (!keyPressed.includes(key)) {
        setKeyPressed((prev) => [...prev, key]);
        // Also add to recorded keys if not already there
        if (!recordedKeys.includes(key)) {
          setRecordedKeys((prev) => [...prev, key]);
        }
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (cleanup) return;
      e.preventDefault();

      // Get the key with OS-specific naming and normalize it
      const rawKey = getKeyName(e, osType);
      const key = normalizeKey(rawKey);

      // Remove from currently pressed keys
      setKeyPressed((prev) => prev.filter((k) => k !== key));

      // If no keys are pressed anymore, commit the shortcut
      const updatedKeyPressed = keyPressed.filter((k) => k !== key);
      if (updatedKeyPressed.length === 0 && recordedKeys.length > 0) {
        // Create the shortcut string from all recorded keys
        const newShortcut = recordedKeys.join("+");

        if (editingShortcutId && bindings[editingShortcutId]) {
          try {
            await updateBinding(editingShortcutId, newShortcut);
            // Re-register the shortcut now that recording is finished
            await invoke("resume_binding", { id: editingShortcutId }).catch(
              console.error,
            );
          } catch (error) {
            console.error("Failed to change binding:", error);
            toast.error(`Failed to set shortcut: ${error}`);

            // Reset to original binding on error
            if (originalBinding) {
              try {
                await updateBinding(editingShortcutId, originalBinding);
                await invoke("resume_binding", { id: editingShortcutId }).catch(
                  console.error,
                );
              } catch (resetError) {
                console.error("Failed to reset binding:", resetError);
                toast.error("Failed to reset shortcut to original value");
              }
            }
          }

          // Exit editing mode and reset states
          setEditingShortcutId(null);
          setKeyPressed([]);
          setRecordedKeys([]);
          setOriginalBinding("");
        }
      }
    };

    // Add click outside handler
    const handleClickOutside = async (e: MouseEvent) => {
      if (cleanup) return;
      const activeElement = shortcutRefs.current.get(editingShortcutId);
      if (activeElement && !activeElement.contains(e.target as Node)) {
        // Cancel shortcut recording and restore original binding
        if (editingShortcutId && originalBinding) {
          try {
            await updateBinding(editingShortcutId, originalBinding);
            await invoke("resume_binding", { id: editingShortcutId }).catch(
              console.error,
            );
          } catch (error) {
            console.error("Failed to restore original binding:", error);
            toast.error("Failed to restore original shortcut");
          }
        } else if (editingShortcutId) {
          invoke("resume_binding", { id: editingShortcutId }).catch(
            console.error,
          );
        }
        setEditingShortcutId(null);
        setKeyPressed([]);
        setRecordedKeys([]);
        setOriginalBinding("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("click", handleClickOutside);

    return () => {
      cleanup = true;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("click", handleClickOutside);
    };
  }, [
    keyPressed,
    recordedKeys,
    editingShortcutId,
    bindings,
    originalBinding,
    updateBinding,
    osType,
  ]);

  // Start recording a new shortcut
  const startRecording = async (id: string) => {
    if (editingShortcutId === id) return; // Already editing this shortcut

    // Suspend current binding to avoid firing while recording
    await invoke("suspend_binding", { id }).catch(console.error);

    // Store the original binding to restore if canceled
    setOriginalBinding(bindings[id]?.current_binding || "");
    setEditingShortcutId(id);
    setKeyPressed([]);
    setRecordedKeys([]);
  };

  // Format the current shortcut keys being recorded
  const formatCurrentKeys = (): string => {
    if (recordedKeys.length === 0) return "Press keys...";

    // Use the same formatting as the display to ensure consistency
    return formatKeyCombination(recordedKeys.join("+"), osType);
  };

  // Store references to shortcut elements
  const setShortcutRef = (id: string, ref: HTMLDivElement | null) => {
    shortcutRefs.current.set(id, ref);
  };

  // If still loading, show loading state
  if (isLoading) {
    return (
      <SettingContainer
        title="Handy Translate Shortcut"
        description="Configure keyboard shortcut for speech-to-text recording with translation"
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="text-sm text-mid-gray">Loading shortcuts...</div>
      </SettingContainer>
    );
  }

  // Get the translate binding for this component, or create default if not present
  const translateBinding = bindings["transcribe_translate"];
  
  // Create default binding if not present
  const getDefaultTranslateShortcut = () => {
    switch (osType) {
      case "macos":
        return "option+shift+space";
      case "windows":
      case "linux":
        return "ctrl+shift+space";
      default:
        return "alt+shift+space";
    }
  };

  const effectiveBinding = translateBinding || {
    id: "transcribe_translate",
    name: "Transcribe & Translate",
    description: "Converts your speech into text and translates it to English.",
    default_binding: getDefaultTranslateShortcut(),
    current_binding: getDefaultTranslateShortcut(),
  };

  return (
    <SettingContainer
      title="Handy Translate Shortcut"
      description="Set the keyboard shortcut to start speech-to-text recording with translation to English"
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <div className="flex items-center space-x-1">
        {editingShortcutId === "transcribe_translate" ? (
          <div
            ref={(ref) => setShortcutRef("transcribe_translate", ref)}
            className="px-2 py-1 text-sm font-semibold border border-logo-primary bg-logo-primary/30 rounded min-w-[120px] text-center"
          >
            {formatCurrentKeys()}
          </div>
        ) : (
          <div
            className="px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 hover:bg-logo-primary/10 rounded cursor-pointer hover:border-logo-primary"
            onClick={() => startRecording("transcribe_translate")}
          >
            {formatKeyCombination(effectiveBinding.current_binding, osType)}
          </div>
        )}
        <ResetButton
          onClick={() => resetBinding("transcribe_translate")}
          disabled={isUpdating("binding_transcribe_translate")}
        />
      </div>
    </SettingContainer>
  );
};