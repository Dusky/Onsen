/**
 * A WordPiece tokenizer for the bundled embedding model (SPEC §11, §20 phase
 * 137).
 *
 * MiniLM/BERT-family tokenization: lowercase, split on whitespace and
 * punctuation, then greedy longest-match subwords with the `##` continuation
 * prefix. Pure — no I/O, no model — so it is testable without downloading
 * anything.
 */

export interface Tokenized {
  ids: number[];
  mask: number[];
  typeIds: number[];
}

export class WordPieceTokenizer {
  private readonly vocab = new Map<string, number>();
  private readonly unk: number;
  private readonly cls: number;
  private readonly sep: number;

  constructor(vocabText: string) {
    const lines = vocabText.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    lines.forEach((word, index) => this.vocab.set(word, index));
    this.unk = this.vocab.get("[UNK]") ?? 100;
    this.cls = this.vocab.get("[CLS]") ?? 101;
    this.sep = this.vocab.get("[SEP]") ?? 102;
  }

  /** Split into word-ish tokens the way BERT's basic tokenizer does. */
  private basicTokenize(text: string): string[] {
    return text.toLowerCase().split(/[^\w]+/).filter((part) => part !== "");
  }

  /** Greedy longest-match WordPiece for one word. */
  private wordpiece(word: string, isFirst: boolean): number[] {
    const ids: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found: number | null = null;
      while (start < end) {
        const candidate = (start === 0 && isFirst ? "" : "##") + word.slice(start, end);
        const id = this.vocab.get(candidate);
        if (id !== undefined) {
          found = id;
          break;
        }
        end -= 1;
      }
      if (found === null) {
        ids.push(this.unk);
        break;
      }
      ids.push(found);
      start = end;
    }
    return ids;
  }

  encode(text: string, maxLength = 512): Tokenized {
    const words = this.basicTokenize(text);
    let ids: number[] = [this.cls];
    words.forEach((word, index) => {
      ids.push(...this.wordpiece(word, index === 0));
    });
    ids = ids.slice(0, maxLength - 1);
    ids.push(this.sep);
    const length = ids.length;
    return {
      ids,
      mask: new Array(length).fill(1),
      typeIds: new Array(length).fill(0),
    };
  }
}
