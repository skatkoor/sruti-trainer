// Feedback colours (SrutiTrainer/UI/Palette.swift): softer than pure red/yellow on a dark screen.
export const COLORS = {
  inTune: 'rgb(66,217,120)',
  near: 'rgb(255,199,71)',
  off: 'rgb(255,115,107)',
  target: 'rgb(66,217,120)',
};

export const zoneColor = (zone) => (zone === 'green' ? COLORS.inTune : zone === 'yellow' ? COLORS.near : COLORS.off);

/** 'rgb(r,g,b)' → 'rgba(r,g,b,a)' */
export const alpha = (rgb, a) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);

export const inTuneColor = (fraction) => (fraction >= 0.7 ? COLORS.inTune : fraction >= 0.4 ? COLORS.near : COLORS.off);
