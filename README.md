# Nítido

Triagem de fotos no browser, afinada para Fujifilm. Mede o foco onde importa (olhos, ponto de AF, sujeito), deteta olhos fechados, tremido e foco falhado, agrupa fotos parecidas, escolhe a melhor de cada grupo e exporta XMP para o Lightroom. Nenhuma foto sai do teu computador.

*English below.*

## Arrancar

Precisas de [Node.js](https://nodejs.org) 18 ou mais recente e de um Chrome, Edge, Firefox ou Safari recente.

```sh
npm start
```

Abre o browser em `http://127.0.0.1:4173`. Não há dependências para instalar. Larga a pasta da sessão na janela (JPEG e RAF juntos, como saem do cartão).

- **Chrome e Edge** permitem gravar os XMP diretamente na pasta. Nos outros browsers a exportação descarrega um ZIP.
- **Primeira análise**: os modelos de IA (~100 MB) descarregam-se uma vez e ficam em cache no browser.
- **Reabrir a mesma pasta** é imediato: os resultados e as tuas decisões ficam guardados localmente.

### Sem internet

```sh
npm run models   # descarrega os modelos para ./models (uma vez)
npm start
```

As bibliotecas de IA continuam a vir do CDN na primeira utilização e ficam depois em cache no browser.

## Como avalia cada foto

1. **Descodifica** o JPEG (ou a pré-visualização embutida no RAF, se não houver JPEG) num worker, em faixas, sem nunca criar um canvas com o tamanho da foto.
2. **Deteta rostos e sujeitos** com MediaPipe: probabilidade de piscar de cada olho, sorriso, orientação do rosto, e objetos como carros, animais e pessoas. Pessoas pequenas são revistas à resolução total.
3. **Escolhe onde medir**, por esta ordem: olhos do rosto principal, rosto, olhos e rosto detetados pela câmara, ponto de AF, sujeito detetado pela câmara, sujeito detetado pela app e, por fim, a zona mais nítida da foto.
4. **Mede o desfoque a 100%**, em píxeis de largura de aresta (método de re-blur de Zhuo & Sim). Não depende do contraste nem da quantidade de textura, por isso uma pintura lisa com um friso nítido mede bem. Também mede a imagem inteira (mapa de 48 zonas), o ruído e a direção do desfoque (tremido).
5. **CLIP** (opcional) dá a semelhança entre fotos para agrupar, uma pontuação de qualidade e uma segunda opinião sobre a nitidez do sujeito.
6. **Veredicto**: Manter, Rever ou Rejeitar, com motivos (desfocada, tremida, foco falhado, olhos fechados, a piscar, menos nítida que o grupo, exposição, sem detalhe). O fundo desfocado intencional é reconhecido e não penaliza.
7. **Pontuação 0–100** para escolher a melhor do grupo: nitidez, olhos abertos, expressão, exposição, qualidade, ruído e comparação com o resto do grupo.

### Detalhes Fujifilm

- O `FocusPixel` está no referencial de píxeis do próprio JPEG (não do sensor). Isto foi confirmado em 51 ficheiros de exemplo, incluindo X-H2, pelo projeto [riffle](https://github.com/minodisk/riffle).
- Em foco manual a câmara continua a escrever um ponto de AF antigo, por isso é ignorado.
- Os rostos, olhos e sujeitos detetados pela câmara também são usados.
- JPEG M/S e pré-visualizações de RAF são medidos à escala da resolução total do modelo.

## Agrupar

Os grupos formam-se assim:

- A sessão é dividida em **cenas** sempre que há pausas longas.
- Dentro de cada cena, as fotos parecidas juntam-se por agrupamento hierárquico (ligação média). A semelhança combina o conteúdo da imagem (CLIP), a composição e a cor (hash perceptual) e a proximidade no tempo.

Podes também:

- Agrupar por rajadas ou por cenas em vez de por semelhança.
- Dar nome aos grupos. Os nomes automáticos vêm do conteúdo, por exemplo "Carro · 14:23".
- Ordenar os grupos por hora, tamanho, pontuação ou nome. Os grupos aparecem na linha do tempo entre as fotos soltas.
- Tirar uma foto do grupo, dividir um grupo, juntar grupos ou juntar uma seleção num grupo.

## Triar (T)

Um grupo de cada vez, em ecrã inteiro. A melhor sugerida aparece grande, as outras fotos do grupo numa fila por baixo, e cada pessoa tem uma linha com o rosto em todas as fotos da rajada, para veres logo em qual estão todos de olhos abertos. **Enter** mantém a foto mostrada e rejeita as outras do grupo; **P** e **X** decidem só esta; **← →** mudam de foto, **↑ ↓** de grupo; **Z** dá zoom a 100% no foco. Também entram as fotos soltas que estão por rever.

## Calibrar ao teu olho

No painel da visão geral, **Calibrar** mostra 12 recortes a 100% à volta do limite atual e pergunta "nítida o suficiente?". O limite que melhor explica as tuas respostas passa a ser o limite de nitidez.

## Aprender contigo

Cada foto que manténs ou rejeitas à mão (P/X) ensina o modelo pessoal, em todas as sessões. Rejeitar "o resto do grupo" não conta, porque essas fotos são repetidas, não más. O modelo é uma regressão logística sobre os mesmos sinais. Com 30 decisões e 85% de acerto liga-se sozinho, e podes desligá-lo ou fazê-lo esquecer nos Modelos de IA.

## Concluir: arrumar no disco, sem Lightroom

**Concluir** mostra quantas fotos vão para cada lado antes de mexer em alguma coisa:

- **Manter** (e, se quiseres, as que estão por rever): copiadas com o RAF e o XMP para uma pasta de destino, por exemplo a pasta do NAS. Podem ir para uma pasta com o nome da sessão, por data (`2026/2026-09-15`) ou diretamente. Cada cópia é verificada pelo tamanho, e um ficheiro igual que já lá esteja é saltado, por isso podes correr outra vez se for interrompido. Os originais ficam onde estão.
- **Rejeitar**: postas de parte em `_rejeitadas` dentro da pasta da sessão (por omissão), apagadas de vez (com confirmação; o browser não consegue usar o lixo) ou deixadas. Depois de as veres, "Esvaziar" apaga a pasta `_rejeitadas`.

Isto funciona no Chrome e no Edge quando a pasta é aberta com *Escolher pasta* ou arrastada. No Safari e no Firefox, Concluir descarrega um script (`.sh` ou `.ps1`) que faz o mesmo e corre dentro da pasta da sessão.

## Instalar e usar sem internet

No Chrome ou no Edge, instala o Nítido a partir da barra de endereço. Depois de uma primeira análise com internet (ou de `npm run models`), funciona offline.

## Exportar

- **XMP**: estrelas, etiqueta de cor, escolha/rejeição e palavras-chave (`Nítido|…`). Os XMP existentes são editados no lugar, mantendo as revelações do Lightroom. No Lightroom Classic, usa *Metadados › Ler metadados do ficheiro* depois de importar.
- **CSV** e **JSON** com todas as métricas.
- **Scripts** (`.sh` e `.ps1`) que movem as rejeitadas (JPEG, RAF e XMP) para `_rejeitadas`.

## Atalhos

| Tecla | Ação |
| --- | --- |
| ← → | Foto anterior ou seguinte |
| ↑ ↓ | Grupo anterior ou seguinte (no visualizador) |
| P / X / U | Manter / rejeitar / automático |
| Shift+X | Manter esta e rejeitar o resto do grupo |
| 1–5, 0 | Estrelas, limpar |
| 6–9 | Etiqueta vermelha, amarela, verde, azul |
| Z | Zoom 100% no foco |
| M / F / B | Mapa de nitidez / rostos / zona de foco |
| C | Comparar o grupo ou a seleção (até 4, zoom sincronizado) |
| T | Modo de triagem |
| Enter (triagem) | Manter esta e rejeitar as outras do grupo |
| ? | Ajuda |

## Publicar num servidor

É um site estático: a análise corre sempre no browser de quem o usa.

- **Docker**: `docker build -t nitido . && docker run -p 8080:80 nitido`
- **Qualquer alojamento estático** (Nginx, Cloudflare Pages, Netlify, Vercel, S3): publica `index.html`, `styles/`, `src/` e, se quiseres, `models/`. É necessário HTTPS (ou localhost).

## Estrutura

```
src/core      lógica pura e testada: EXIF/Fuji, geometria, métricas, pontuação, grupos, XMP, ZIP
src/workers   descodificação e medição (pixel.worker), CLIP (clip.worker)
src/ml        MediaPipe (rostos, objetos), cliente CLIP, configuração dos modelos
src/app       estado, pipeline, cache IndexedDB, exportação
src/ui        galeria, visualizador, comparação, histograma
src/i18n      português e inglês
```

`npm test` corre os testes unitários. `npm run test:smoke` arranca a app completa com um DOM simulado. `npm run test:browser -- --photos ~/pasta-de-fotos` corre a app no Chrome real (headless) com os modelos verdadeiros, guarda capturas de ecrã em vários tamanhos e falha com qualquer erro na página (Node ≥ 22; `--only DSCF0001,DSCF0002` abre essas fotos na lupa, `--dump medidas.json` grava as medições de cada foto).

## Limitações

- Os limites por omissão foram calibrados com ficheiros da X-H2: fotos nítidas medem 0,7–1,4 px, as visivelmente desfocadas 2 px ou mais. Afina o rigor com o histograma.
- Uma foto muito desfocada ou tremida com muito grão (Grain Effect) pode medir como nítida, porque o grão é o único detalhe fino que resta. Quando há uma foto parecida tirada segundos antes ou depois, a comparação a escala grosseira apanha a tremida e manda-a para Rever; uma foto isolada assim pode escapar.
- A deteção de rostos (MediaPipe) é mais fiável em rostos de frente e razoavelmente grandes. Perfis pronunciados não contam como olhos fechados.
- O CLIP usa a variante quantizada ViT-B/32 em WebAssembly. Em máquinas lentas pode desligá-lo nos Modelos de IA.

---

# Nítido (English)

In-browser photo culling, tuned for Fujifilm. It measures focus where it matters (eyes, AF point, subject), detects closed eyes, motion blur and missed focus, groups similar shots, picks the best of each group and exports XMP for Lightroom. No photo leaves your computer.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer and a recent Chrome, Edge, Firefox or Safari.

```sh
npm start
```

This opens `http://127.0.0.1:4173`. There is nothing to install. Drop your session folder on the window (JPEG and RAF together, straight off the card).

- **Chrome and Edge** can write XMP straight into the folder. Other browsers download a ZIP instead.
- **First analysis**: the AI models (~100 MB) download once and are then cached by the browser.
- **Reopening the same folder** is instant: results and your decisions are stored locally.

Offline: run `npm run models` once, then `npm start`.

## How each photo is judged

1. **Decode** the JPEG (or the RAF's embedded preview when there is no JPEG) in a worker, in strips, without ever creating a full-size canvas.
2. **Detect faces and subjects** with MediaPipe: per-eye blink probability, smile, face orientation, and objects such as cars, animals and people. Small people are checked again at full resolution.
3. **Choose where to measure**, in this order: the main face's eyes, the face, the camera's own eye and face boxes, the AF point, the camera's subject box, the app's subject box, and finally the sharpest area of the frame.
4. **Measure blur at 100%** as edge width in pixels (Zhuo & Sim re-blur method). It does not depend on contrast or texture, so smooth car paint with one crisp panel line measures fine. It also measures the whole frame (a 48-zone map), the noise, and the direction of the blur (camera shake).
5. **CLIP** (optional) gives similarity between shots for grouping, a quality score and a second opinion on subject sharpness.
6. **Verdict**: Keep, Review or Reject, with reasons (out of focus, motion blur, missed focus, eyes closed, blinking, softer than the group, exposure, no detail). Intentional background blur is recognised and not penalised.
7. **Score from 0 to 100** to pick the best of each group: sharpness, open eyes, expression, exposure, quality, noise, and comparison with the rest of the group.

### Fujifilm details

- `FocusPixel` is in the JPEG's own pixel frame, not the sensor's. This was confirmed on 51 sample files, X-H2 included, by the [riffle](https://github.com/minodisk/riffle) project.
- In manual focus the camera still writes a stale AF point, so it is ignored.
- The camera's own face, eye and subject boxes are used too.
- M/S JPEGs and RAF previews are measured on the model's full-resolution scale.

## Grouping, learning, export, deployment

- **Grouping**:
  - The session is split into scenes at long pauses.
  - Within each scene, similar shots are joined by average-linkage clustering on image content (CLIP), composition and colour (perceptual hash), and closeness in time.
  - You can rename groups, sort them, detach photos, split groups or join them.
- **Culling mode (T)**: one group at a time, full screen. The suggested best is large, the other frames sit in a strip, and each person gets a row with their face in every frame of the burst. **Enter** keeps the shown frame and rejects the rest of the group; **P**/**X** decide just this one; **← →** change frame, **↑ ↓** change group; **Z** zooms to 100% on focus. Loose photos still to review are included.
- **Calibrate to your eye**: in the overview panel, 12 crops at 100% around the current limit, "sharp enough?" for each; the limit that best explains the answers becomes the sharpness limit.
- **Personal model**: every photo you keep or reject by hand (P/X) teaches it, across all shoots. "Reject the rest of the group" does not count: those frames are redundant, not bad. With 30 decisions and 85% agreement it turns itself on; turn it off or make it forget under AI models.
- **Finish: sort on disk, no Lightroom needed**. It shows how many photos go where before touching anything.
  - Keepers (and, by choice, the photos still to review) are copied with their RAF and XMP to a destination folder such as a NAS share: into a folder named after the shoot, by capture date (`2026/2026-09-15`) or straight in. Each copy is checked by size, and identical files already there are skipped, so an interrupted run can simply be repeated. Originals stay where they are.
  - Rejects are set aside in `_rejects` inside the shoot folder (the default), deleted for good (with confirmation; a browser cannot use the bin) or left alone. "Empty" removes the `_rejects` folder once you have looked.
  - This works in Chrome and Edge when the folder was opened with *Choose folder* or dropped. In Safari and Firefox, Finish downloads a `.sh` or `.ps1` script that does the same, to run inside the shoot folder.
- **Install and offline**: install it from the address bar in Chrome or Edge. After one analysis online (or `npm run models`), it works offline.
- **Export**:
  - XMP with stars, colour label, pick/reject and keywords. Existing XMP files are edited in place, so Lightroom develop settings survive.
  - CSV and JSON reports.
  - Scripts that move rejects into `_rejects`.
- **Deploy**: it is a static site, and analysis always runs in the visitor's browser. Use `docker build -t nitido . && docker run -p 8080:80 nitido`, or upload `index.html`, `styles/`, `src/` (and optionally `models/`) to any static host with HTTPS.

## Limitations

- Default limits were calibrated on X-H2 files: sharp frames measure 0.7–1.4 px, visibly soft ones 2 px and up. Tune the strictness with the histogram.
- A badly blurred or shaken frame with heavy grain (Grain Effect) can measure as sharp, because the grain is the only fine detail left. When a similar frame was shot seconds before or after, the coarse-scale comparison catches the shake and sends it to Review; a lone frame like that can slip through.

Tests: `npm test` (unit), `npm run test:smoke` (whole app on a stub DOM), `npm run test:browser -- --photos ~/some-shoot` (real headless Chrome with the real models; screenshots at several widths, fails on any page error; Node ≥ 22).
- Face detection is most reliable on frontal, reasonably large faces. Strong profiles are not counted as closed eyes.
- CLIP is the quantised ViT-B/32 running in WebAssembly. You can turn it off under AI models on slow machines.
