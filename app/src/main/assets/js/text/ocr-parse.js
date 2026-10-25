// Parses Gemini's page transcription into lines with boxes. Pure: unit-testable in Node.

/**
 * @param raw  the model's reply: a JSON array of { text, box_2d: [ymin, xmin, ymax, xmax] } (0-1000), possibly
 *             wrapped in a code fence
 * @returns    [{ text, b: [top, left, bottom, right] }] with b normalised to 0-1
 */
export function parseOcr(raw) {
  let json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = json.indexOf('[');
  const end = json.lastIndexOf(']');
  if (start >= 0 && end > start) json = json.slice(start, end + 1);

  let array;
  try { array = JSON.parse(json); } catch (err) { throw new Error('Gemini returned something that was not valid JSON.'); }
  if (!Array.isArray(array)) throw new Error('Gemini did not return a list of lines.');

  const lines = [];
  array.forEach((entry, index) => {
    const text = String((entry && (entry.text || entry.line || entry.t)) || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    let box = entry.box_2d || entry.box || entry.b;
    if (Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number')) {
      box = box.map((n) => Math.min(1000, Math.max(0, n)) / 1000);
      if (box[2] <= box[0]) box[2] = Math.min(1, box[0] + 0.02);
      if (box[3] <= box[1]) box[3] = Math.min(1, box[1] + 0.05);
    } else {
      // No usable box: give the line an evenly spaced full-width strip so it stays tappable.
      const count = Math.max(1, array.length);
      box = [(index + 0.1) / count, 0.05, (index + 0.9) / count, 0.95];
    }
    lines.push({ text, b: box });
  });
  return lines;
}
