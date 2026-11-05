// Petit générateur de QR code (mode octets, correction M, versions 1 à 9),
// sans dépendance. Suffit largement pour l'adresse d'une salle de buzzers.
// D'après la spécification ISO/IEC 18004 et l'algorithme de Project Nayuki (MIT).
(function () {
  "use strict";

  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22]; // niveau M
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5];
  var FORMAT_M = 0;

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(v) {
    return Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];
  }

  // Corps de Galois GF(256), polynôme 0x11D
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = mul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = mul(root, 2);
    }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function utf8(text) {
    var s = unescape(encodeURIComponent(text)), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text);
    var ver = 1;
    while (ver <= 9 && bytes.length + 2 > dataCodewords(ver)) ver++;
    if (ver > 9) return null; // au-delà, la longueur se code sur 16 bits
    var size = ver * 4 + 17;
    var capacity = dataCodewords(ver);

    // Flux de bits : mode octets (0100), longueur sur 8 bits, données
    var bits = [];
    var put = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, 8);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, capacity * 8 - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (var pad = 0xEC; data.length < capacity; pad ^= 0xEC ^ 0x11) data.push(pad);

    // Blocs + correction d'erreurs, puis entrelacement
    var nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = divisor(eccLen), blocks = [], k = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= nShort) all.push(blocks[j][i]);
      }
    }

    // Matrice
    var mod = [], fn = [];
    for (i = 0; i < size; i++) {
      mod.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    var set = function (x, y, dark) { mod[y][x] = dark; fn[y][x] = true; };

    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (p) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = p[0] + dx, y = p[1] + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    });
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2;
      var step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      var pos = [6];
      for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
          set(pos[i] + dx2, pos[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
        }
      }
    }
    var drawFormat = function (mask) {
      var d = (FORMAT_M << 3) | mask, r = d;
      for (var n = 0; n < 10; n++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var f = ((d << 10) | r) ^ 0x5412;
      var bit = function (n2) { return ((f >>> n2) & 1) !== 0; };
      for (n = 0; n <= 5; n++) set(8, n, bit(n));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (n = 9; n < 15; n++) set(14 - n, 8, bit(n));
      for (n = 0; n < 8; n++) set(size - 1 - n, 8, bit(n));
      for (n = 8; n < 15; n++) set(8, size - 15 + n, bit(n));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      var r = ver;
      for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = (ver << 12) | r;
      for (i = 0; i < 18; i++) {
        var on = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        set(a, c, on); set(c, a, on);
      }
    }

    // Placement en zigzag
    var n = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && n < all.length * 8) {
          mod[y][x] = ((all[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0;
          n++;
        }
      }
    }

    // Masque : on garde celui qui donne le moins de motifs gênants
    var masks = [
      function (x, y) { return (x + y) % 2 === 0; },
      function (x, y) { return y % 2 === 0; },
      function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return x * y % 2 + x * y % 3 === 0; },
      function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
    ];
    var apply = function (m) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        if (!fn[yy][xx] && masks[m](xx, yy)) mod[yy][xx] = !mod[yy][xx];
      }
    };
    var penalty = function () {
      var score = 0, dark = 0, yy, xx;
      for (yy = 0; yy < size; yy++) {
        var runR = 1, runC = 1;
        for (xx = 0; xx < size; xx++) {
          if (mod[yy][xx]) dark++;
          if (xx > 0) {
            if (mod[yy][xx] === mod[yy][xx - 1]) { runR++; if (runR === 5) score += 3; else if (runR > 5) score++; } else runR = 1;
            if (mod[xx][yy] === mod[xx - 1][yy]) { runC++; if (runC === 5) score += 3; else if (runC > 5) score++; } else runC = 1;
          }
          if (xx > 0 && yy > 0 && mod[yy][xx] === mod[yy][xx - 1] && mod[yy][xx] === mod[yy - 1][xx] && mod[yy][xx] === mod[yy - 1][xx - 1]) score += 3;
        }
      }
      return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      apply(m); drawFormat(m);
      var s = penalty();
      if (s < bestScore) { bestScore = s; best = m; }
      apply(m);
    }
    apply(best); drawFormat(best);
    return mod;
  }

  // Dessin en SVG (4 modules de marge blanche autour, comme le veut la norme)
  function svg(text, dark, light) {
    var m = encode(text);
    if (!m) return "";
    var size = m.length, q = 4, path = "";
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      if (m[y][x]) path += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
    }
    var full = size + 2 * q;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + " " + full + '" shape-rendering="crispEdges">' +
      '<rect width="' + full + '" height="' + full + '" fill="' + (light || "#fff") + '"/>' +
      '<path d="' + path + '" fill="' + (dark || "#000") + '"/></svg>';
  }

  window.MiamsQR = { encode: encode, svg: svg };
})();
