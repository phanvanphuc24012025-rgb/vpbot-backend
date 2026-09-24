// ============================================
// utils.js - Helper dùng chung
// ============================================

export function newId() {
  return crypto.randomUUID();
}

export function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 số
}

export function nowIso() {
  return new Date().toISOString();
}

export function addSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Công thức điểm gốc từ Match.js: score = kill*2 + topPoint + damage/100
export function getTopPoint(top) {
  if (top === 1) return 10;
  if (top === 2) return 6;
  if (top === 3) return 4;
  if (top >= 4 && top <= 5) return 2;
  return 0;
}

export function calcScore({ kill, top, damage }) {
  const score = kill * 2 + getTopPoint(top) + damage / 100;
  return Math.round(score * 100) / 100;
}

export function genReferralCode(username) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${(username || 'REF').slice(0, 4).toUpperCase()}${rand}`;
}

export function planDurationDays(planName) {
  if (planName === '1month') return 30;
  if (planName === '2month') return 60;
  return 30;
}

// Bảng giá gói dịch vụ (VNĐ) - chỉnh lại theo giá thật của bạn
export const PLAN_PRICES = {
  '1month': 99000,
  '2month': 179000
};

export function genTransactionCode() {
  return `VPB${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
