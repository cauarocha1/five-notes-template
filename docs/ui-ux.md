# Interface e experiência

## Direção

O Five mantém o tema escuro e prioriza captura rápida, leitura e navegação previsível. As ideias aproveitadas de outros produtos são padrões de interação; a interface, o código e os ativos continuam próprios do Five.

## Computador

O layout principal usa dois painéis: uma árvore única de pastas, notas e quadros, e o conteúdo aberto. A árvore conserva a expansão no aparelho, indica o item ativo e aceita mover arquivos ou pastas por arrastar. Os menus de cada pasta oferecem criação contextual, renomear, mover e excluir; mover por teclado ou toque abre um seletor de destino. `Ctrl/⌘ + K` foca a busca global e `Ctrl/⌘ + N` cria uma nota.

A busca percorre títulos e conteúdo das notas, além dos títulos dos quadros. Criar dentro de uma pasta usa essa pasta como destino; criar pela busca global indica Entrada como destino. O editor preserva a estrutura Markdown e apresenta conexões no próprio texto.

## iPhone

A navegação segue três passos: **Pastas → itens → nota ou quadro**. A tela inicial mostra pastas e itens recentes; a lista mostra notas e quadros da pasta escolhida; a nota ocupa a tela inteira e tem retorno explícito para a lista. Busca e criação ficam no cabeçalho. Ações de organização permanecem no menu contextual da pasta ou no seletor “Mover para…”.

O cabeçalho e o conteúdo usam os insets dinâmicos `env(safe-area-inset-*)` do Safari/PWA. Não há altura fixa para notch ou Dynamic Island: a medida varia por modelo e orientação. A Apple publica telas atuais entre 360 e 440 pontos de largura lógica (por exemplo, 390 × 844 pt no iPhone 16e e 402 × 874 pt no iPhone 17); o layout móvel permanece até 1000 pt para continuar no fluxo móvel em paisagem. O documento usa `viewport-fit=cover`, `100dvh` e fallback `100vh`. [Dimensões e safe areas da Apple](https://developer.apple.com/design/human-interface-guidelines/layout), [safe areas no WebKit](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

A nota oferece uma barra compacta de formatação junto ao conteúdo, compatível com toque. A informação de sincronização só ocupa espaço persistente quando há algo a resolver; a cópia local continua imediatamente disponível. O mapa e o backup permanecem acessíveis sem comprimir o layout de computador.

## Conexões entre notas e quadros

Uma referência a quadro aparece como link/cartão Markdown no ponto do texto em que foi inserida e também no painel de conexões. A referência guarda o ID estável; o título exibido acompanha o título atual. Referências antigas em sintaxe de imagem continuam sendo lidas e são apresentadas como links normais.

Dentro de um quadro, **Notas vinculadas e inserir nota** lista as notas que mencionam o quadro e permite adicionar outra por busca. A nota inserida vira um cartão Excalidraw vinculado ao ID. Abrir o cartão ou uma nota que menciona o quadro salva o desenho antes de navegar; o retorno no iPhone abre o mesmo quadro. Remover um cartão remove a referência, sem excluir a nota. Um cartão cuja nota ou quadro foi removido continua identificável e mostra um aviso recuperável.

## Salvamento, sincronização e recuperação

- Antes de React iniciar, a tela estática mostra um botão de nova tentativa se o módulo do app não montar em 12 segundos; depois da montagem, erros da interface mostram sua própria ação para recuperar.
- A edição é gravada primeiro no IndexedDB local. A fila de operações permanece no aparelho se a rede cair.
- O estado de sync distingue modo local, verificando, sincronizado, pendente, offline, indisponibilidade do serviço e acesso Cloudflare Access expirado.
- Uma nova versão da PWA pede uma atualização explícita; antes de recarregar, aguarda as gravações da nota, do quadro e da fila local.
- A exclusão de pasta realoca, em uma transação local, notas e quadros para a pasta mãe ou Entrada; subpastas são preservadas no nível da pasta excluída. As alterações entram na fila de sync.
- Backup JSON continua disponível. Antes de trocar de aparelho ou publicar uma versão real, exporte e guarde um backup.

## Acessibilidade e validação

Os controles principais têm nomes acessíveis, foco visível, busca por teclado e ações contextuais que não dependem de hover. O menu fecha por Escape. As funções de formatação do iPhone também têm rótulos para leitor de tela.

A suíte local cobre links Markdown, formato por toque, árvore, movimentação e realocação de arquivos em pastas. A simulação foi conferida em 390 × 844; os insets variáveis e dimensões publicadas orientam o CSS, mas não substituem Safari/PWA físico com teclado e rotação. O Worker exige JWT de Access fora de localhost; testes cobrem respostas de autenticação e preservação da fila. Uma sessão expirada e a causa da tela preta após reinício não foram reproduzidas ao vivo. A recuperação de inicialização e o ciclo de atualização offline foram verificados em navegador desktop, sem atribuir causa à tela preta.
