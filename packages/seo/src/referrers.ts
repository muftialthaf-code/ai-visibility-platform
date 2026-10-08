/** Referrer hostnames used to attribute visits to AI assistants. */
export const AI_REFERRERS: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'www.perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
};

/** Returns the assistant name for a referrer URL, or null when it is not an AI assistant. */
export function classifyReferrer(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return AI_REFERRERS[new URL(referrer).hostname] ?? null;
  } catch {
    return null;
  }
}

/** Small inline script (no dependencies) that reports AI-assistant referrals to Plausible, if present. */
export function aiReferralScript(): string {
  const map = JSON.stringify(AI_REFERRERS);
  return `(function(){try{var m=${map};var h=new URL(document.referrer).hostname;var a=m[h];if(a&&window.plausible){window.plausible('AI Referral',{props:{assistant:a}})}}catch(e){}})();`;
}
