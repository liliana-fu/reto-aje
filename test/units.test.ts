import { firstContenido, formatContenido, parseContenido, precioPor100 } from '../src/shared/units';

describe('units', () => {
  test.each([
    ['Fotoprotector Eucerin Oil Control SPF 50 50 ml', { valor: 50, unidad: 'ml' }],
    ['FRASCO 50 ML', { valor: 50, unidad: 'ml' }],
    ['DESODORANTE MENTA PERUVIAN HEALTH 79GR', { valor: 79, unidad: 'g' }],
    ['Jabón 115g', { valor: 115, unidad: 'g' }],
    ['Agua micelar 1.5L', { valor: 1500, unidad: 'ml' }],
    ['Crema corporal 0,5 kg', { valor: 500, unidad: 'g' }],
    ['118 ml', { valor: 118, unidad: 'ml' }],
  ])('parseContenido("%s")', (text, expected) => {
    expect(parseContenido(text)).toEqual(expected);
  });

  test('SPF 50 o FPS50+ no son contenido', () => {
    expect(parseContenido('Bloqueador Solar mineral diario SPF 30 Badger')).toBeUndefined();
    expect(parseContenido('Protector Solar Eucerin Oil Control FPS50+')).toBeUndefined();
    expect(parseContenido('Gel Limpiador Glicólico')).toBeUndefined();
  });

  test('firstContenido respeta el orden de prioridad', () => {
    expect(firstContenido(undefined, 'sin tamaño', 'FRASCO 473 ML', '50 ml')).toEqual({ valor: 473, unidad: 'ml' });
    expect(firstContenido('nada')).toBeUndefined();
  });

  test('formatContenido', () => {
    expect(formatContenido({ valor: 118, unidad: 'ml' })).toBe('118 ml');
    expect(formatContenido(undefined)).toBe('');
  });

  test('precio por 100 ml/g', () => {
    expect(precioPor100(119, { valor: 118, unidad: 'ml' })).toBe(100.85);
    expect(precioPor100(89.9, { valor: 50, unidad: 'ml' })).toBe(179.8);
    expect(precioPor100(null, { valor: 50, unidad: 'ml' })).toBeNull();
    expect(precioPor100(10, undefined)).toBeNull();
  });
});
