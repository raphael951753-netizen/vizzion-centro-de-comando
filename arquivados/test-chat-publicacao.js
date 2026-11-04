// Testes isolados para a interpretação de comandos de publicação via chat
function today() { return '2026-11-03'; }
function parsePrecoBr(v) { return parseFloat(String(v || '').replace(/[^\d,]/g, '').replace(',', '.')); }

const P = [
  { id: 'p1', title: 'Smartphone Gamer Pro 5G', price: '2.499,90', image: 'https://exemplo.com/img1.jpg', projectId: 'proj1' },
  { id: 'p2', title: 'Celular Moto Edge 40', price: '1.199,00', image: 'https://exemplo.com/img2.jpg', projectId: 'proj1' },
  { id: 'p3', title: 'Notebook Samsung Book', price: '4.599,90', image: '', projectId: 'proj2' },
  { id: 'p4', title: 'Fone de Ouvido Bluetooth', price: '299,00', image: 'https://exemplo.com/img4.jpg', projectId: 'proj1' },
  { id: 'p5', title: 'TV Smart 50 Polegadas', price: '2.899,90', image: 'https://exemplo.com/img5.jpg', projectId: 'proj3' },
  { id: 'p6', title: 'Smartphone Xiaomi Redmi 12', price: '899,90', image: 'https://exemplo.com/img6.jpg', projectId: 'proj2' },
  { id: 'p7', title: 'Celular iPhone 13', price: '3.299,90', image: 'https://exemplo.com/img7.jpg', projectId: 'proj3' },
];

function interpretarComandoLocal(text, anexos = []) {
  const t = text.trim();
  const tl = t.toLowerCase();
  const redes = [];
  if (tl.match(/\bfacebook\b/)) redes.push('facebook');
  if (tl.match(/\binstagram\b/)) redes.push('instagram');
  if (tl.match(/\btiktok\b/)) redes.push('tiktok');
  if (tl.match(/\byoutube\b/)) redes.push('youtube');
  if (!redes.length && tl.match(/\b(facebook|instagram|tiktok|youtube)\b/)) redes.push(tl.match(/\b(facebook|instagram|tiktok|youtube)\b/)[1]);

  const aspas = t.match(/['"](.+)['"]/);
  const legendaAspas = aspas ? aspas[1].trim() : '';
  const textoSemAspas = t.replace(/['"][^'"]*['"]/g, '').trim();

  const ehAgendamento = tl.match(/\b(agende|agendar|agendado|amanh|as\s+\d{1,2}:\d{2}|\d{1,2}:\d{2})/i);
  const ehPublicarAgora = tl.match(/\b(poste|publica|publicar|publique|postar|agora|envie|mande)\b/i) && !ehAgendamento;

  let produtoNome = null;
  let produtoFaixaMin = null;
  let produtoFaixaMax = null;
  let produtoGenerico = false;
  const mProdNome = tl.match(/(?:produto|item|celular|smartphone|moto|iphone|samsung|xiaomi)\s+([a-zà-ú0-9 .\-]{2,40}?)(?:\s+(?:no|na|entre|de|\$|R\$|reais|real|no|na|do|da|com|para|por|em|agora|hoje|amanh))?\s*$/i);
  if (mProdNome) {
    const candidatoNome = mProdNome[1].trim();
    if (!/^(mais|menos|um|uma|qualquer|o|a|os|as)\s/i.test(candidatoNome) &&
        !/\b(mais|menos)\s+(barato|caro)\b/i.test(candidatoNome) &&
        !/\b(menor|maior)\s+pre[cç]o\b/i.test(candidatoNome) &&
        candidatoNome.length <= 40) {
      produtoNome = candidatoNome;
    }
  }
  if (tl.match(/\b(qualquer\s+)?(celular|smartphone|produto|item)\b/i)) produtoGenerico = true;
  const mFaixa = tl.match(/entre\s+([\d.,]+)\s+e\s+([\d.,]+)/i);
  if (mFaixa) { produtoFaixaMin = parseFloat(mFaixa[1].replace(',', '.')); produtoFaixaMax = parseFloat(mFaixa[2].replace(',', '.')); }
  const mMaisBarato = tl.match(/\b(mais\s+barato|barato|menor\s+preco|menor preço)\b/i);
  const mMaisCaro = tl.match(/\b(mais\s+caro|caro|maior\s+preco|maior preço)\b/i);

  const querPublicarAnexo = (ehPublicarAgora || ehAgendamento) && redes.length && anexos.length;
  if (querPublicarAnexo) {
    const rede = redes[0];
    const arquivo = anexos[0];
    const legenda = legendaAspas || textoSemAspas.replace(/\b(poste|publica|publicar|postar|mande|envie|essa|esta|a|ela|ele|no|para|pra|com|texto|de|agora|facebook|instagram|tiktok|youtube|marketplace)\b/gi, '').trim() || 'Publicação via IA';
    let facebook_destino = null;
    if (tl.match(/\bmarketplace\b/)) facebook_destino = 'marketplace';
    else if (tl.match(/\bfeed\b/)) facebook_destino = 'feed';
    return {
      nome: ehAgendamento ? 'publicar_post_agendado' : 'publicar_post',
      args: { texto: legenda, redes: [rede], facebook_destino, arquivo_nome: arquivo.nome, arquivo_tipo: arquivo.tipo, arquivo_dados: arquivo.dados.split(',')[1] || arquivo.dados, automatico: true, agendado: ehAgendamento ? true : undefined, postNow: !ehAgendamento },
      resposta: ehAgendamento ? 'Publicação agendada para ' + rede + ' com anexo ' + arquivo.nome + '...' : 'Publicando "' + legenda + '" no ' + rede + '...',
    };
  }

  if ((ehPublicarAgora || ehAgendamento) && redes.length && (produtoNome || produtoGenerico || produtoFaixaMin !== null || mMaisBarato || mMaisCaro || legendaAspas)) {
    const rede = redes[0];
    let produto = null;
    if (produtoNome) {
      produto = P.find(p => String(p.title || '').toLowerCase().includes(produtoNome.toLowerCase()));
    }
    if (!produto && mMaisCaro) {
      const candidatos = P.filter(p => { const preco = parsePrecoBr(p.price); if (preco <= 0) return false; if (produtoGenerico) { const title = String(p.title || '').toLowerCase(); return title.includes('celular') || title.includes('smartphone') || title.includes('iphone') || title.includes('samsung') || title.includes('moto') || title.includes('xiaomi'); } return true; }).sort((a, b) => parsePrecoBr(b.price) - parsePrecoBr(a.price));
      produto = candidatos[0] || null;
    }
    if (!produto && mMaisBarato) {
      const candidatos = P.filter(p => { const preco = parsePrecoBr(p.price); if (preco <= 0) return false; if (produtoGenerico) { const title = String(p.title || '').toLowerCase(); return title.includes('celular') || title.includes('smartphone') || title.includes('iphone') || title.includes('samsung') || title.includes('moto') || title.includes('xiaomi'); } return true; }).sort((a, b) => parsePrecoBr(a.price) - parsePrecoBr(b.price));
      produto = candidatos[0] || null;
    }
    if (!produto && produtoFaixaMin !== null && produtoFaixaMax !== null) {
      const candidatos = P.filter(p => { const preco = parsePrecoBr(p.price); return preco >= produtoFaixaMin && preco <= produtoFaixaMax; }).sort((a, b) => parsePrecoBr(a.price) - parsePrecoBr(b.price));
      produto = candidatos[0] || null;
    }
    if (!produto && produtoGenerico) {
      const candidatos = P.filter(p => { const title = String(p.title || '').toLowerCase(); return title.includes('celular') || title.includes('smartphone') || title.includes('iphone') || title.includes('samsung') || title.includes('moto') || title.includes('xiaomi'); });
      produto = candidatos[0] || null;
    }
    if (!produto) return { nome: 'erro_produto', args: {}, resposta: 'Não encontrei produto no catálogo' + (produtoNome ? ' "' + produtoNome + '"' : '') + (produtoFaixaMin !== null ? ' entre R$ ' + produtoFaixaMin + ' e R$ ' + produtoFaixaMax : '') + '.' };
    const legenda = legendaAspas || produto.title + ' - confira esta oferta!';
    let facebook_destino = null;
    if (tl.match(/\bmarketplace\b/)) facebook_destino = 'marketplace';
    else if (tl.match(/\bfeed\b/)) facebook_destino = 'feed';
    return {
      nome: ehAgendamento ? 'publicar_post_agendado' : 'publicar_post',
      args: { texto: legenda, redes: [rede], facebook_destino, produto_id: produto.id, produto_nome: produto.title, produtoImages: !!tl.match(/\b(midia do produto|mídia do produto|imagem do produto|foto do produto)\b/i), automatico: true, agendado: ehAgendamento ? true : undefined, postNow: !ehAgendamento },
      resposta: ehAgendamento ? 'Publicação agendada: "' + legenda + '" no ' + rede + ' (produto: ' + produto.title + ')...' : 'Publicando "' + legenda + '" no ' + rede + ' (produto: ' + produto.title + ')...',
    };
  }
  return null;
}

let passou = 0;
let falhou = 0;
function test(nome, fn) {
  try { fn(); passou++; console.log('PASS: ' + nome); } catch (e) { falhou++; console.log('FAIL: ' + nome + ' - ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error((m || 'Valores diferentes') + ': esperado "' + b + '", obteve "' + a + '"'); }

test('1. publicar celular no facebook feed agora', () => {
  const cmd = interpretarComandoLocal('publica um celular no facebook feed agora com texto de ia e mídia do produto', []);
  assert(cmd !== null); assert(cmd.nome === 'publicar_post'); assert(cmd.args.redes.includes('facebook')); assert(cmd.args.facebook_destino === 'feed'); assert(cmd.args.postNow === true); assert(cmd.args.produto_id !== undefined);
});
test('2. celular mais barato do catalogo', () => {
  const cmd = interpretarComandoLocal('/publicar facebook celular mais barato catálogo texto gerado por ia mídia do produto agora', []);
  assert(cmd !== null); assert(cmd.nome === 'publicar_post'); assert(cmd.args.redes.includes('facebook'));
  const produto = P.find(p => p.id === cmd.args.produto_id);
  assert(produto !== undefined);
  assertEqual(produto.title, 'Smartphone Xiaomi Redmi 12', 'celular mais barato esperado Xiaomi Redmi 12, obteve ' + produto.title);
  assert(cmd.args.produtoImages === true);
});
test('3. celular Samsung mais barato no instagram', () => {
  const cmd = interpretarComandoLocal('publique o celular Samsung mais barato no instagram', []);
  assert(cmd !== null); assert(cmd.args.redes.includes('instagram'));
  const produto = P.find(p => p.id === cmd.args.produto_id);
  assert(produto !== undefined); assert(produto.title.toLowerCase().includes('samsung'));
});
test('4. produto mais barato entre 100 e 300 reais', () => {
  const cmd = interpretarComandoLocal('publique o produto mais barato entre 100 e 300 reais no facebook', []);
  assert(cmd !== null);
  const produto = P.find(p => p.id === cmd.args.produto_id);
  assert(produto !== undefined);
  const preco = parsePrecoBr(produto.price);
  assert(preco >= 100 && preco <= 300, 'preço ' + preco + ' deve estar entre 100 e 300');
});
test('5. agende amanha às 13:00 celular mais barato', () => {
  const cmd = interpretarComandoLocal('agende amanhã às 13:00 um post com o celular mais barato', []);
  assert(cmd !== null); assert(cmd.nome === 'publicar_post_agendado'); assert(cmd.args.postNow === false); assert(cmd.args.agendado === true);
});
test('6. publicar no tiktok com mídia do produto', () => {
  const cmd = interpretarComandoLocal('publique no tiktok com mídia do produto', []);
  assert(cmd !== null); assert(cmd.args.redes.includes('tiktok')); assert(cmd.args.produtoImages === true);
});
test('7. comando sem rede retorna null', () => {
  const cmd = interpretarComandoLocal('publica um produto agora', []);
  assert(cmd === null);
});
test('8. produto não encontrado', () => {
  const cmd = interpretarComandoLocal('publique o produto xyz inexistente no facebook', []);
  assert(cmd !== null); assert(cmd.nome === 'erro_produto');
});
test('9. faixa sem produtos', () => {
  const cmd = interpretarComandoLocal('publique produto entre 100000 e 200000 reais no facebook', []);
  assert(cmd !== null); assert(cmd.nome === 'erro_produto');
});
test('10. agendamento reconhecido', () => {
  const cmd = interpretarComandoLocal('agende para hoje às 10:00 um post no facebook', []);
  assert(cmd !== null); assert(cmd.nome === 'publicar_post_agendado');
});
test('11. Facebook Feed', () => {
  const cmd = interpretarComandoLocal('publique produto no facebook feed agora', []);
  assert(cmd !== null); assert(cmd.args.facebook_destino === 'feed');
});
test('12. Facebook Marketplace', () => {
  const cmd = interpretarComandoLocal('publique produto no facebook marketplace agora', []);
  assert(cmd !== null); assert(cmd.args.facebook_destino === 'marketplace');
});
test('13. anexo imagem instagram', () => {
  const cmd = interpretarComandoLocal('publique essa foto no instagram agora', [{ nome: 'foto.jpg', tipo: 'image/jpeg', dados: 'data:image/jpeg;base64,/9j/' }]);
  assert(cmd !== null); assert(cmd.args.redes.includes('instagram')); assert(cmd.args.arquivo_nome === 'foto.jpg');
});
test('14. texto entre aspas', () => {
  const cmd = interpretarComandoLocal('publique celular no facebook com texto "Oferta incrível!" agora', []);
  assert(cmd !== null); assert(cmd.args.texto === 'Oferta incrível!');
});

console.log('\n' + passou + ' passou, ' + falhou + ' falhou');
process.exit(falhou > 0 ? 1 : 0);
