// Minimal bounded wire-format reader for Anki metadata. No generated/runtime code is executed.
export function protobufFields(bytes: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const fields = new Map<number, (number | Uint8Array)[]>(); let position = 0;
  const varint = (): number => {
    let value = 0; let factor = 1;
    for (let index = 0; index < 10; index += 1) {
      if (position >= bytes.length) throw new Error('Metadados Anki incompletos.');
      const byte = bytes[position++]; value += (byte & 127) * factor;
      if (!(byte & 128)) return value;
      factor *= 128;
    }
    throw new Error('Metadados Anki inválidos.');
  };
  while (position < bytes.length) {
    const tag = varint(); const id = Math.floor(tag / 8); const wire = tag & 7;
    if (!Number.isSafeInteger(tag) || id < 1) throw new Error('Metadados Anki inválidos.');
    let value: number | Uint8Array;
    if (wire === 0) value = varint();
    else if (wire === 2 || wire === 1 || wire === 5) {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || length < 0 || position + length > bytes.length) throw new Error('Metadados Anki truncados.');
      value = bytes.subarray(position, position + length); position += length;
    } else throw new Error('Metadados Anki com tipo não suportado.');
    const values = fields.get(id) ?? []; values.push(value); fields.set(id, values);
    if (values.length > 10_000) throw new Error('O pacote contém metadados demais.');
  }
  return fields;
}
