"use client";

export interface UserProfile {
  name: string;
  avatar: string;
  color: string;
}

export const AVATAR_OPTIONS = [
  "🦊", "🐼", "🦁", "🐯", "🐨", "🦄", "🚀", "🎧", "🌟", "🤖",
  "🐱", "🐶", "🦉", "🐙", "🐬", "🔥", "⚡", "🎮", "👑", "🌈"
];

export const COLOR_OPTIONS = [
  { name: "Indigo", bg: "bg-indigo-600", border: "border-indigo-500", text: "text-indigo-400" },
  { name: "Emerald", bg: "bg-emerald-600", border: "border-emerald-500", text: "text-emerald-400" },
  { name: "Violet", bg: "bg-violet-600", border: "border-violet-500", text: "text-violet-400" },
  { name: "Rose", bg: "bg-rose-600", border: "border-rose-500", text: "text-rose-400" },
  { name: "Amber", bg: "bg-amber-600", border: "border-amber-500", text: "text-amber-400" },
  { name: "Cyan", bg: "bg-cyan-600", border: "border-cyan-500", text: "text-cyan-400" },
];

const DEFAULT_NAMES = [
  "Friendly Fox", "Happy Panda", "Curious Lion", "Swift Tiger",
  "Cool Koala", "Cosmic Voyager", "Sound Master", "Global Voice"
];

const STORAGE_KEY = "livetranslate_user_profile";

export function getStoredUserProfile(): UserProfile {
  if (typeof window === "undefined") {
    return { name: "Guest User", avatar: "👤", color: "indigo" };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("[Profile] Failed to read from localStorage:", e);
  }

  // Generate random default profile
  const randomName = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
  const randomAvatar = AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)];
  const defaultProfile: UserProfile = {
    name: randomName,
    avatar: randomAvatar,
    color: "indigo",
  };

  saveStoredUserProfile(defaultProfile);
  return defaultProfile;
}

export function saveStoredUserProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn("[Profile] Failed to save to localStorage:", e);
  }
}
