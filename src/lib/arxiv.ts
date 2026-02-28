/**
 * Extract the arxiv ID from an arxiv URL.
 * Handles formats like:
 *   https://arxiv.org/abs/2301.12345
 *   https://arxiv.org/pdf/2301.12345
 *   https://arxiv.org/pdf/2301.12345v2
 */
export function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  return match ? match[1] : null;
}
