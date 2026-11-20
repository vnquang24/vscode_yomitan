export interface DeinflectCandidate {
  term: string;
  reasons: string[];
}

// Bitmask condition flags (modeled after Yomitan's condition groups)
const V1 = 1 << 0; // Ichidan verb (食べる, 見る, られる, せる)
const V5 = 1 << 1; // Godan verb (書く, 読む, 話す, 買う...)
const VS = 1 << 2; // Suru verb (する, 実装する)
const VK = 1 << 3; // Kuru verb (来る, くる)
const ADJ_I = 1 << 4; // i-adjective (高い, 難しい, ない, たい)
const MASU_STEM = 1 << 5; // Intermediate polite stem
const NOUN = 1 << 6; // Terminal noun stem after stripping する
const V_ANY = V1 | V5 | VS | VK;

interface DeinflectRule {
  inflected: string;
  deinflected: string;
  reason: string;
  /** Allowed outer condition mask (0 = allowed from surface input) */
  conditionsIn: number;
  /** Condition mask of resulting deinflected form */
  conditionsOut: number;
}

const RULES: DeinflectRule[] = [
  // Polite (-masu) family -> MASU_STEM or direct
  { inflected: 'ませんでした', deinflected: '', reason: 'phủ định quá khứ lịch sự', conditionsIn: 0, conditionsOut: MASU_STEM },
  { inflected: 'ません', deinflected: '', reason: 'phủ định lịch sự', conditionsIn: 0, conditionsOut: MASU_STEM },
  { inflected: 'ました', deinflected: '', reason: 'quá khứ lịch sự', conditionsIn: 0, conditionsOut: MASU_STEM },
  { inflected: 'ましょう', deinflected: '', reason: 'rủ rê lịch sự', conditionsIn: 0, conditionsOut: MASU_STEM },
  { inflected: 'ます', deinflected: '', reason: 'lịch sự (-ます)', conditionsIn: 0, conditionsOut: MASU_STEM },

  // MASU_STEM -> base verb
  { inflected: '', deinflected: 'る', reason: '', conditionsIn: MASU_STEM, conditionsOut: V1 },
  { inflected: 'い', deinflected: 'う', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'き', deinflected: 'く', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'ぎ', deinflected: 'ぐ', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'し', deinflected: 'す', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'ち', deinflected: 'つ', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'に', deinflected: 'ぬ', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'び', deinflected: 'ぶ', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'み', deinflected: 'む', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'り', deinflected: 'る', reason: '', conditionsIn: MASU_STEM, conditionsOut: V5 },
  { inflected: 'し', deinflected: 'する', reason: '', conditionsIn: MASU_STEM, conditionsOut: VS },
  { inflected: 'き', deinflected: 'くる', reason: '', conditionsIn: MASU_STEM, conditionsOut: VK },
  { inflected: '来', deinflected: '来る', reason: '', conditionsIn: MASU_STEM, conditionsOut: VK },

  // Progressive -ている / -てる -> -て / -で
  { inflected: 'ている', deinflected: 'て', reason: 'tiếp diễn (-ている)', conditionsIn: 0 | V1, conditionsOut: 0 },
  { inflected: 'でいる', deinflected: 'で', reason: 'tiếp diễn (-でいる)', conditionsIn: 0 | V1, conditionsOut: 0 },
  { inflected: 'てる', deinflected: 'て', reason: 'tiếp diễn (-てる)', conditionsIn: 0 | V1, conditionsOut: 0 },
  { inflected: 'でる', deinflected: 'で', reason: 'tiếp diễn (-でる)', conditionsIn: 0 | V1, conditionsOut: 0 },
  { inflected: 'ておく', deinflected: 'て', reason: 'chuẩn bị sẵn (-ておく)', conditionsIn: 0 | V5, conditionsOut: 0 },
  { inflected: 'てしまう', deinflected: 'て', reason: 'hoàn tất (-てしまう)', conditionsIn: 0 | V5, conditionsOut: 0 },
  { inflected: 'ちゃう', deinflected: 'て', reason: 'hoàn tất (-ちゃう)', conditionsIn: 0 | V5, conditionsOut: 0 },
  { inflected: 'じゃう', deinflected: 'で', reason: 'hoàn tất (-じゃう)', conditionsIn: 0 | V5, conditionsOut: 0 },
  { inflected: 'てください', deinflected: 'て', reason: 'yêu cầu lịch sự (-てください)', conditionsIn: 0, conditionsOut: 0 },
  { inflected: 'でください', deinflected: 'で', reason: 'yêu cầu lịch sự (-でください)', conditionsIn: 0, conditionsOut: 0 },

  // -て / -で and past -た / -だ -> base verb
  { inflected: 'て', deinflected: 'る', reason: 'thể て', conditionsIn: 0, conditionsOut: V1 },
  { inflected: 'た', deinflected: 'る', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V1 },
  { inflected: 'って', deinflected: 'う', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'って', deinflected: 'つ', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'って', deinflected: 'る', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'った', deinflected: 'う', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'った', deinflected: 'つ', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'った', deinflected: 'る', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'いて', deinflected: 'く', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'いた', deinflected: 'く', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'いで', deinflected: 'ぐ', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'いだ', deinflected: 'ぐ', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'して', deinflected: 'す', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'した', deinflected: 'す', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んで', deinflected: 'ぬ', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んで', deinflected: 'ぶ', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んで', deinflected: 'む', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んだ', deinflected: 'ぬ', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んだ', deinflected: 'ぶ', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'んだ', deinflected: 'む', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: '行って', deinflected: '行く', reason: 'thể て', conditionsIn: 0, conditionsOut: V5 },
  { inflected: '行った', deinflected: '行く', reason: 'quá khứ', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'して', deinflected: 'する', reason: 'thể て', conditionsIn: 0, conditionsOut: VS },
  { inflected: 'した', deinflected: 'する', reason: 'quá khứ', conditionsIn: 0, conditionsOut: VS },
  { inflected: 'きて', deinflected: 'くる', reason: 'thể て', conditionsIn: 0, conditionsOut: VK },
  { inflected: 'きた', deinflected: 'くる', reason: 'quá khứ', conditionsIn: 0, conditionsOut: VK },
  { inflected: '来て', deinflected: '来る', reason: 'thể て', conditionsIn: 0, conditionsOut: VK },
  { inflected: '来た', deinflected: '来る', reason: 'quá khứ', conditionsIn: 0, conditionsOut: VK },

  // i-Adjective inflections (including auxiliary -ない and -たい)
  { inflected: 'くなかった', deinflected: 'い', reason: 'phủ định quá khứ', conditionsIn: 0, conditionsOut: ADJ_I },
  { inflected: 'くない', deinflected: 'い', reason: 'phủ định', conditionsIn: 0 | ADJ_I, conditionsOut: ADJ_I },
  { inflected: 'かった', deinflected: 'い', reason: 'quá khứ', conditionsIn: 0, conditionsOut: ADJ_I },
  { inflected: 'くて', deinflected: 'い', reason: 'thể て', conditionsIn: 0, conditionsOut: ADJ_I },
  { inflected: 'ければ', deinflected: 'い', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: ADJ_I },
  { inflected: 'く', deinflected: 'い', reason: 'phó từ (-く)', conditionsIn: 0, conditionsOut: ADJ_I },
  { inflected: 'さ', deinflected: 'い', reason: 'danh từ hóa (-さ)', conditionsIn: 0, conditionsOut: ADJ_I },

  // Negative -ない (behaves as ADJ_I on outside!)
  { inflected: 'ない', deinflected: 'る', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V1 },
  { inflected: 'わない', deinflected: 'う', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'かない', deinflected: 'く', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'がない', deinflected: 'ぐ', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'さない', deinflected: 'す', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'たない', deinflected: 'つ', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'なない', deinflected: 'ぬ', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'ばない', deinflected: 'ぶ', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'まない', deinflected: 'む', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'らない', deinflected: 'る', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: V5 },
  { inflected: 'しない', deinflected: 'する', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: VS },
  { inflected: 'こない', deinflected: 'くる', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: VK },
  { inflected: '来ない', deinflected: '来る', reason: 'phủ định (-ない)', conditionsIn: 0 | ADJ_I, conditionsOut: VK },
  { inflected: 'ず', deinflected: 'る', reason: 'phủ định (-ず)', conditionsIn: 0, conditionsOut: V1 },
  { inflected: 'せず', deinflected: 'する', reason: 'phủ định (-せず)', conditionsIn: 0, conditionsOut: VS },

  // Desiderative -たい (behaves as ADJ_I on outside)
  { inflected: 'たい', deinflected: '', reason: 'mong muốn (-たい)', conditionsIn: 0 | ADJ_I, conditionsOut: MASU_STEM },

  // Passive / Potential (-られる / -れる, behaves as V1 on outside!)
  { inflected: 'られる', deinflected: 'る', reason: 'bị động / khả năng', conditionsIn: 0 | V1, conditionsOut: V1 },
  { inflected: 'われる', deinflected: 'う', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'かれる', deinflected: 'く', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'がれる', deinflected: 'ぐ', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'される', deinflected: 'す', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'たれる', deinflected: 'つ', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'なれる', deinflected: 'ぬ', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'ばれる', deinflected: 'ぶ', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'まれる', deinflected: 'む', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'られる', deinflected: 'る', reason: 'bị động', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'される', deinflected: 'する', reason: 'bị động (-される)', conditionsIn: 0 | V1, conditionsOut: VS },
  { inflected: 'こられる', deinflected: 'くる', reason: 'bị động / khả năng', conditionsIn: 0 | V1, conditionsOut: VK },
  { inflected: '来られる', deinflected: '来る', reason: 'bị động / khả năng', conditionsIn: 0 | V1, conditionsOut: VK },

  // Potential Godan (-える -> V1)
  { inflected: 'える', deinflected: 'う', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'ける', deinflected: 'く', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'げる', deinflected: 'ぐ', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'せる', deinflected: 'す', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'てる', deinflected: 'つ', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'ねる', deinflected: 'ぬ', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'べる', deinflected: 'ぶ', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'める', deinflected: 'む', reason: 'khả năng', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'れる', deinflected: 'る', reason: 'khả năng / lược ら', conditionsIn: 0 | V1, conditionsOut: V1 | V5 },

  // Causative (-させる / -せる -> behaves as V1 on outside!)
  { inflected: 'させる', deinflected: 'る', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V1 },
  { inflected: 'わせる', deinflected: 'う', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'かせる', deinflected: 'く', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'がせる', deinflected: 'ぐ', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'させる', deinflected: 'す', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'たせる', deinflected: 'つ', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'なせる', deinflected: 'ぬ', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'ばせる', deinflected: 'ぶ', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'ませる', deinflected: 'む', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'らせる', deinflected: 'る', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: V5 },
  { inflected: 'させる', deinflected: 'する', reason: 'sai khiến (-させる)', conditionsIn: 0 | V1, conditionsOut: VS },
  { inflected: 'こさせる', deinflected: 'くる', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: VK },
  { inflected: '来させる', deinflected: '来る', reason: 'sai khiến', conditionsIn: 0 | V1, conditionsOut: VK },

  // Conditional -ば & Volitional -よう / -おう
  { inflected: 'れば', deinflected: 'る', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V1 | V5 | VK },
  { inflected: 'えば', deinflected: 'う', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'けば', deinflected: 'く', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'せば', deinflected: 'す', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'てば', deinflected: 'つ', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'めば', deinflected: 'む', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: V5 },
  { inflected: 'すれば', deinflected: 'する', reason: 'điều kiện (-ば)', conditionsIn: 0, conditionsOut: VS },
  { inflected: 'よう', deinflected: 'る', reason: 'ý chí (-よう)', conditionsIn: 0, conditionsOut: V1 },
  { inflected: 'しよう', deinflected: 'する', reason: 'ý chí (-しよう)', conditionsIn: 0, conditionsOut: VS },

  // Suru-verb stem extraction (実装する -> 実装 so noun dictionaries match! Terminal NOUN condition stops further verb stripping)
  { inflected: 'する', deinflected: '', reason: 'động từ hóa (-する)', conditionsIn: 0 | VS, conditionsOut: NOUN }
];

const WHOLE_WORD_IRREGULARS = new Set(['行く', 'くる', '来る', 'する']);

interface QueueNode {
  term: string;
  conditions: number;
  reasons: string[];
  depth: number;
}

export function deinflect(source: string, maxDepth = 6): DeinflectCandidate[] {
  const trimmed = source.trim();
  if (!trimmed) return [];

  const queue: QueueNode[] = [
    { term: trimmed, conditions: 0, reasons: [], depth: 0 }
  ];
  const bestByTerm = new Map<string, DeinflectCandidate>();
  bestByTerm.set(trimmed, { term: trimmed, reasons: [] });

  const visitedStates = new Set<string>([`${trimmed}|0`]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const rule of RULES) {
      if (current.conditions !== 0) {
        if (rule.conditionsIn === 0) {
          // Rule with conditionsIn === 0 only applies if current is surface (0) OR Intermediate stem -> te/etc.
          // Note: progressive rules like ている -> て set conditionsOut = 0 so -て rules can fire next!
          continue;
        }
        if ((current.conditions & rule.conditionsIn) === 0) {
          continue;
        }
      } else if (rule.conditionsIn === MASU_STEM) {
        // Pure MASU_STEM expansion only runs after stripping -ます / -たい
        continue;
      }

      if (!current.term.endsWith(rule.inflected)) {
        continue;
      }

      const stemLen = current.term.length - rule.inflected.length;
      if (stemLen < 1 && !WHOLE_WORD_IRREGULARS.has(rule.deinflected)) {
        continue;
      }
      const nextTerm = current.term.slice(0, stemLen) + rule.deinflected;
      if (nextTerm.length === 0) {
        continue;
      }

      const nextReasons = rule.reason
        ? [rule.reason, ...current.reasons]
        : [...current.reasons];

      const stateKey = `${nextTerm}|${rule.conditionsOut}`;
      if (visitedStates.has(stateKey)) {
        continue;
      }
      visitedStates.add(stateKey);

      if (rule.conditionsOut !== MASU_STEM && !bestByTerm.has(nextTerm)) {
        bestByTerm.set(nextTerm, {
          term: nextTerm,
          reasons: nextReasons
        });
      }

      queue.push({
        term: nextTerm,
        conditions: rule.conditionsOut,
        reasons: nextReasons,
        depth: current.depth + 1
      });
    }
  }

  return Array.from(bestByTerm.values());
}
