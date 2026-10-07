// 블록 코드: 파이썬처럼 들여쓰기로 묶는 작은 언어.
//
//   x = 0
//   wT:
//       if jump:
//           disapp()
//           wait(1)
//           appear()
//       move(0.05, 0)
//
// - 한 줄에 문장 하나. ':'로 끝나는 줄(if, else, wT, until) 아래는 들여써서 묶는다.
// - '#' 뒤는 주석 (단, #ff0000처럼 '#'+16진 6자리는 색깔 값)
// - 반복(wT, until)은 한 바퀴마다 한 프레임 쉬고, wait(초)는 그만큼 쉰다.
// - 좌표 단위는 칸, 각도는 도(0 위 · 90 오른쪽 · 180 아래 · 270 왼쪽), 투명도는 0(불투명)~100(완전 투명)
// - 변수는 블록마다 따로. 이름이 '_'로 끝나는 변수(예: 점수_)는 그 월드의 모든 블록이 같이 쓴다.

class ScriptError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

// 명령: 문장으로만 쓰고 값을 내지 않음. 값은 인자 개수.
const SCRIPT_COMMANDS = {
  convert: 1, rot: 1, Tran: 1, TranPlus: 1, move: 2, px: 2, disapp: 0, appear: 0, wait: 1,
  rotMove: 2, noKey: 1, yesKey: 1, caTp: 2, kill: 0, perm: 0,
};
// 값을 내는 함수
const SCRIPT_REPORTERS = {
  blockTag: 0, cooX: 0, cooY: 0, pxColor: 1, caCooX: 0, caCooY: 0, sin: 1, cos: 1, tan: 1, abs: 1,
};
// 참/거짓 조건 (괄호 없이 씀)
const SCRIPT_FLAGS = ['dis', 'app', 'jump', 'headbutt', 'stick'];
const SCRIPT_RESERVED = new Set(['if', 'else', 'wT', 'until', 'and', 'or', 'not', ...SCRIPT_FLAGS,
  ...Object.keys(SCRIPT_COMMANDS), ...Object.keys(SCRIPT_REPORTERS)]);
const SCRIPT_OP_LIMIT = 10000; // 한 프레임에 실행하는 문장 수 상한 (넘으면 다음 프레임으로 넘김)

const ID_RE = /^[A-Za-z_가-힣ㄱ-ㆎ][A-Za-z0-9_가-힣ㄱ-ㆎ]*/;
const HEX_RE = /^#[0-9a-fA-F]{6}(?![0-9A-Za-z_])/;

// '#' 주석 지우기 (따옴표 안과 #rrggbb 색은 그대로)
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') {
      if (HEX_RE.test(s.slice(i))) i += 6;
      else return s.slice(0, i);
    }
  }
  return s;
}

function tokenize(text, line) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if (rest[0] === ' ') i++;
    else if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) {
      tokens.push({ t: 'num', v: parseFloat(m[1]) });
      i += m[1].length;
    } else if ((m = HEX_RE.exec(rest))) {
      tokens.push({ t: 'str', v: m[0].toLowerCase() });
      i += 7;
    } else if (rest[0] === '"' || rest[0] === "'") {
      const end = text.indexOf(rest[0], i + 1);
      if (end < 0) throw new ScriptError(line, '따옴표가 닫히지 않았습니다.');
      tokens.push({ t: 'str', v: text.slice(i + 1, end) });
      i = end + 1;
    } else if ((m = ID_RE.exec(rest))) {
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ((m = /^(\/\/|==|!=|<=|>=|\+=|-=|[-+*/%<>=(),:])/.exec(rest))) {
      tokens.push({ t: 'op', v: m[1] });
      i += m[1].length;
    } else throw new ScriptError(line, `'${rest[0]}'를 이해할 수 없습니다.`);
  }
  return tokens;
}

class ExprParser {
  constructor(tokens, line) {
    this.tk = tokens;
    this.i = 0;
    this.line = line;
  }

  peek(v) {
    const t = this.tk[this.i];
    return t && t.t !== 'str' && t.t !== 'num' && t.v === v ? t : null;
  }

  take(v) {
    const t = this.peek(v);
    if (t) this.i++;
    return t;
  }

  expect(v, what) {
    if (!this.take(v)) throw new ScriptError(this.line, `${what}이(가) 필요합니다.`);
  }

  done() {
    return this.i >= this.tk.length;
  }

  expr() {
    let l = this.and();
    while (this.take('or')) l = { k: 'bin', op: 'or', l, r: this.and() };
    return l;
  }

  and() {
    let l = this.not();
    while (this.take('and')) l = { k: 'bin', op: 'and', l, r: this.not() };
    return l;
  }

  not() {
    if (this.take('not')) return { k: 'not', e: this.not() };
    return this.cmp();
  }

  cmp() {
    const l = this.add();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.take(op)) return { k: 'bin', op, l, r: this.add() };
    }
    return l;
  }

  add() {
    let l = this.mul();
    for (;;) {
      const op = this.take('+') || this.take('-');
      if (!op) return l;
      l = { k: 'bin', op: op.v, l, r: this.mul() };
    }
  }

  mul() {
    let l = this.unary();
    for (;;) {
      const op = this.take('*') || this.take('//') || this.take('/') || this.take('%');
      if (!op) return l;
      l = { k: 'bin', op: op.v, l, r: this.unary() };
    }
  }

  unary() {
    if (this.take('-')) return { k: 'neg', e: this.unary() };
    if (this.take('+')) return this.unary();
    return this.primary();
  }

  primary() {
    const t = this.tk[this.i++];
    if (!t) throw new ScriptError(this.line, '식이 덜 끝났습니다.');
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr();
      this.expect(')', "')'");
      return e;
    }
    if (t.t === 'id') {
      if (SCRIPT_FLAGS.includes(t.v)) {
        if (this.peek('(')) throw new ScriptError(this.line, `'${t.v}'는 괄호 없이 씁니다.`);
        return { k: 'flag', name: t.v };
      }
      if (this.take('(')) {
        const args = [];
        if (!this.take(')')) {
          do args.push(this.expr()); while (this.take(','));
          this.expect(')', "')'");
        }
        return { k: 'call', name: t.v, args };
      }
      if (SCRIPT_RESERVED.has(t.v)) throw new ScriptError(this.line, `'${t.v}'가 올 자리가 아닙니다.`);
      return { k: 'var', name: t.v };
    }
    throw new ScriptError(this.line, `'${t.v}'가 올 자리가 아닙니다.`);
  }
}

function parseLine(tokens, line) {
  const p = new ExprParser(tokens, line);
  const first = tokens[0];
  const rest = () => {
    if (!p.done()) throw new ScriptError(line, '줄 끝에 필요 없는 내용이 있습니다.');
  };
  const header = (k, withCond) => {
    p.i = 1;
    const cond = withCond ? p.expr() : null;
    p.expect(':', "줄 끝의 ':'");
    rest();
    return { k, cond, line };
  };
  if (first.t === 'id') {
    if (first.v === 'if') return header('if', true);
    if (first.v === 'until') return header('until', true);
    if (first.v === 'wT') return header('forever', false);
    if (first.v === 'else') return header('else', false);
    const op = tokens[1];
    if (op && op.t === 'op' && ['=', '+=', '-='].includes(op.v)) {
      if (SCRIPT_RESERVED.has(first.v)) throw new ScriptError(line, `'${first.v}'는 이미 쓰는 이름이라 변수로 쓸 수 없습니다.`);
      p.i = 2;
      const e = p.expr();
      rest();
      return { k: 'assign', name: first.v, op: op.v, e, line };
    }
  }
  const e = p.expr();
  rest();
  if (e.k !== 'call') throw new ScriptError(line, '명령이 아닙니다. (예: move(1, 0))');
  return { k: 'cmd', call: e, line };
}

function parseProgram(source) {
  const lines = [];
  String(source).split('\n').forEach((raw, n) => {
    const text = stripComment(raw.replace(/\t/g, '    ')).replace(/\s+$/, '');
    if (!text.trim()) return;
    const indent = text.length - text.trimStart().length;
    lines.push({ indent, tokens: tokenize(text.trim(), n + 1), line: n + 1 });
  });

  let i = 0;
  const childBlock = (L) => {
    const next = lines[i];
    if (!next || next.indent <= L.indent) throw new ScriptError(L.line, "':' 다음 줄은 들여써야 합니다.");
    return block(next.indent);
  };
  const block = (indent) => {
    const stmts = [];
    while (i < lines.length) {
      const L = lines[i];
      if (L.indent < indent) break;
      if (L.indent > indent) throw new ScriptError(L.line, '들여쓰기가 맞지 않습니다.');
      const s = parseLine(L.tokens, L.line);
      i++;
      if (s.k === 'else') {
        const prev = stmts[stmts.length - 1];
        if (!prev || prev.k !== 'if' || prev.else) throw new ScriptError(L.line, "'else:' 앞에 짝이 되는 'if'가 없습니다.");
        prev.else = childBlock(L);
        continue;
      }
      if (s.k === 'if' || s.k === 'until' || s.k === 'forever') s.body = childBlock(L);
      stmts.push(s);
    }
    return stmts;
  };
  const body = block(lines.length ? lines[0].indent : 0);
  if (i < lines.length) throw new ScriptError(lines[i].line, '들여쓰기가 맞지 않습니다.');
  return body;
}

// 이름·인자 개수·변수 확인. noKey/yesKey의 인자는 따옴표 없이 써도 키 이름으로 본다.
function checkProgram(body) {
  const assigned = new Set();
  const collect = (stmts) => {
    for (const s of stmts) {
      if (s.k === 'assign') assigned.add(s.name);
      if (s.body) collect(s.body);
      if (s.else) collect(s.else);
    }
  };
  collect(body);

  const checkCall = (call, line, asCommand) => {
    const { name, args } = call;
    const commandArgs = SCRIPT_COMMANDS[name];
    const reporterArgs = SCRIPT_REPORTERS[name];
    if (commandArgs === undefined && reporterArgs === undefined) throw new ScriptError(line, `'${name}'라는 명령이나 함수는 없습니다.`);
    if (asCommand && commandArgs === undefined) throw new ScriptError(line, `'${name}()'는 값을 내는 함수라 혼자 쓸 수 없습니다.`);
    if (!asCommand && reporterArgs === undefined) throw new ScriptError(line, `'${name}'는 값을 내지 않는 명령이라 식 안에 쓸 수 없습니다.`);
    const want = asCommand ? commandArgs : reporterArgs;
    if (args.length !== want) throw new ScriptError(line, `'${name}'에는 값이 ${want}개 필요합니다. (지금 ${args.length}개)`);
    if ((name === 'noKey' || name === 'yesKey') && args[0].k === 'var' && !assigned.has(args[0].name)) {
      args[0] = { k: 'lit', v: args[0].name };
    }
    args.forEach((a) => checkExpr(a, line));
  };
  const checkExpr = (e, line) => {
    switch (e.k) {
      case 'var':
        // '_'로 끝나는 변수는 다른 블록이 값을 넣을 수 있으니 검사하지 않음
        if (!assigned.has(e.name) && !isShared(e.name)) throw new ScriptError(line, `변수 '${e.name}'에 값을 넣은 적이 없습니다. (예: ${e.name} = 0)`);
        break;
      case 'call': checkCall(e, line, false); break;
      case 'bin': checkExpr(e.l, line); checkExpr(e.r, line); break;
      case 'not': case 'neg': checkExpr(e.e, line); break;
    }
  };
  const walk = (stmts) => {
    for (const s of stmts) {
      if (s.k === 'cmd') checkCall(s.call, s.line, true);
      if (s.k === 'assign') checkExpr(s.e, s.line);
      if (s.cond) checkExpr(s.cond, s.line);
      if (s.body) walk(s.body);
      if (s.else) walk(s.else);
    }
  };
  walk(body);
}

const isShared = (name) => name.endsWith('_');

const Script = {
  // 문법이 틀리면 ScriptError(line, message)를 던진다.
  compile(source) {
    const body = parseProgram(source);
    checkProgram(body);
    return { body };
  },

  // 문제 없으면 null, 있으면 { line, message }
  check(source) {
    try {
      this.compile(source);
      return null;
    } catch (err) {
      if (err instanceof ScriptError) return { line: err.line, message: err.message };
      throw err;
    }
  },
};

const DEG = Math.PI / 180;
const tidy = (x) => Math.round(x * 1e10) / 1e10; // sin(180)이 0이 되도록 아주 작은 오차 정리

// 블록 하나에서 도는 코드. api: 블록·캐릭터를 다루는 함수들 (play.js에서 제공)
// shared: 월드 공통 변수('_'로 끝나는 이름) · vars: 이 블록의 변수 (perm()으로 저장해 둔 값에서 다시 시작할 때)
class ScriptRunner {
  constructor(program, api, shared = {}, vars = {}) {
    this.api = api;
    this.shared = shared;
    this.vars = { ...vars };
    this.line = 0;
    this.dt = 1 / 60;
    this.ops = 0;
    this.done = false;
    this.error = null; // ScriptError (멈춘 이유)
    this.gen = this.run(program.body);
  }

  step(dt) {
    if (this.done) return;
    this.dt = dt;
    this.ops = 0;
    try {
      if (this.gen.next().done) this.done = true;
    } catch (err) {
      this.done = true;
      this.error = err instanceof ScriptError ? err : new ScriptError(this.line, err.message);
    }
  }

  *run(stmts) {
    for (const s of stmts) {
      this.line = s.line;
      if (++this.ops > SCRIPT_OP_LIMIT) {
        this.ops = 0;
        yield;
      }
      switch (s.k) {
        case 'assign': {
          const v = this.eval(s.e);
          const store = isShared(s.name) ? this.shared : this.vars;
          const old = store[s.name] ?? 0;
          store[s.name] = s.op === '=' ? v : s.op === '+=' ? this.plus(old, v) : this.num(old) - this.num(v);
          break;
        }
        case 'cmd': {
          const { name, args } = s.call;
          const values = args.map((a) => this.eval(a));
          if (name === 'wait') {
            let t = this.num(values[0]);
            while (t > 0) {
              yield;
              t -= this.dt;
            }
          } else this.api[name](...values);
          break;
        }
        case 'if':
          if (this.truthy(this.eval(s.cond))) yield* this.run(s.body);
          else if (s.else) yield* this.run(s.else);
          break;
        case 'forever': // 끝나지 않음
          for (;;) {
            yield* this.run(s.body);
            yield;
          }
        case 'until':
          for (;;) {
            this.line = s.line;
            if (this.truthy(this.eval(s.cond))) break;
            yield* this.run(s.body);
            yield;
          }
          break;
      }
    }
  }

  num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    throw new ScriptError(this.line, `숫자가 필요한 곳에 '${v}'가 왔습니다.`);
  }

  truthy(v) {
    return typeof v === 'string' ? v !== '' : !!v;
  }

  plus(a, b) {
    return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : this.num(a) + this.num(b);
  }

  equal(a, b) {
    if (typeof a === 'boolean') a = a ? 1 : 0;
    if (typeof b === 'boolean') b = b ? 1 : 0;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  eval(e) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'var': return (isShared(e.name) ? this.shared : this.vars)[e.name] ?? 0;
      case 'flag': return !!this.api[e.name]();
      case 'not': return !this.truthy(this.eval(e.e));
      case 'neg': return -this.num(this.eval(e.e));
      case 'call': {
        const args = e.args.map((a) => this.eval(a));
        switch (e.name) {
          case 'sin': return tidy(Math.sin(this.num(args[0]) * DEG));
          case 'cos': return tidy(Math.cos(this.num(args[0]) * DEG));
          case 'tan': return tidy(Math.tan(this.num(args[0]) * DEG));
          case 'abs': return Math.abs(this.num(args[0]));
          default: return this.api[e.name](...args);
        }
      }
      case 'bin': {
        if (e.op === 'and') return this.truthy(this.eval(e.l)) && this.truthy(this.eval(e.r));
        if (e.op === 'or') return this.truthy(this.eval(e.l)) || this.truthy(this.eval(e.r));
        const a = this.eval(e.l);
        const b = this.eval(e.r);
        switch (e.op) {
          case '+': return this.plus(a, b);
          case '-': return this.num(a) - this.num(b);
          case '*': return this.num(a) * this.num(b);
          case '==': return this.equal(a, b);
          case '!=': return !this.equal(a, b);
          case '<': return this.num(a) < this.num(b);
          case '>': return this.num(a) > this.num(b);
          case '<=': return this.num(a) <= this.num(b);
          case '>=': return this.num(a) >= this.num(b);
        }
        const d = this.num(b);
        if (d === 0) throw new ScriptError(this.line, '0으로 나눌 수 없습니다.');
        const n = this.num(a);
        if (e.op === '/') return n / d;
        if (e.op === '//') return Math.floor(n / d); // 몫
        return ((n % d) + d) % d; // 나머지
      }
    }
    throw new ScriptError(this.line, '알 수 없는 식입니다.');
  }
}
