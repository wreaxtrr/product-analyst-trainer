"""Чинит типичную ловушку YAML в файлах контента.

Обычная (не взятая в кавычки) строка не может содержать «: » и « #», а также начинаться
с обратной кавычки. Скрипт находит такие однострочные значения у ключей и элементов
списков и переписывает их в блочный вид:

    explain: текст: с двоеточием      →      explain: |-
                                               текст: с двоеточием

Запуск из корня проекта:  python tools/fix_yaml.py content/*.yaml
"""
import re
import sys

KEY_RE = re.compile(r'^(?P<pre>\s*(?:- )?)(?P<key>[A-Za-z_]+): (?P<val>.+)$')
ITEM_RE = re.compile(r'^(?P<pre>\s*)- (?P<val>.+)$')
SAFE_START = ('|', '>', '"', "'", '[', '{')


def needs_fix(val: str) -> bool:
    v = val.strip()
    if not v or v.startswith(SAFE_START):
        return False
    return ': ' in v or ' #' in v or v.startswith(('`', '@', '%', '*', '&', '!', '?', ',')) or v.endswith(':')


def fix_text(text: str) -> tuple[str, int]:
    out, fixed = [], 0
    in_block, block_indent = False, 0
    for line in text.split('\n'):
        stripped = line.lstrip(' ')
        indent = len(line) - len(stripped)
        if in_block:
            if stripped == '' or indent > block_indent:
                out.append(line)
                continue
            in_block = False
        m = KEY_RE.match(line)
        if m:
            val = m.group('val')
            if val.strip() in ('|', '|-', '>', '>-'):
                # содержимое блока — все строки, отступ которых больше колонки ключа
                in_block, block_indent = True, len(m.group('pre'))
                out.append(line)
                continue
            if needs_fix(val):
                key_col = len(m.group('pre'))
                out.append(f"{m.group('pre')}{m.group('key')}: |-")
                out.append(' ' * (key_col + 2) + val.strip())
                fixed += 1
                continue
            out.append(line)
            continue
        m = ITEM_RE.match(line)
        if m and needs_fix(m.group('val')):
            col = len(m.group('pre'))
            out.append(f"{m.group('pre')}- |-")
            out.append(' ' * (col + 4) + m.group('val').strip())
            fixed += 1
            continue
        out.append(line)
    return '\n'.join(out), fixed


if __name__ == '__main__':
    total = 0
    for path in sys.argv[1:]:
        with open(path, encoding='utf-8') as f:
            src = f.read()
        res, n = fix_text(src)
        if n:
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(res)
        print(f'{path}: fixed {n}')
        total += n
    print('total:', total)
