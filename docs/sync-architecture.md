# Sincronização do five

## Caminho de uma edição

1. Cada alteração é salva primeiro no IndexedDB do aparelho.
2. A fila local mantém uma operação por nota ou pasta. Ao atualizar a aplicação, uma migração consolida filas antigas antes de criar um índice único.
3. Após uma pausa curta na digitação, o cliente envia a operação com sua revisão base e um identificador idempotente.
4. O Worker atualiza a entidade, registra a revisão no histórico e grava o identificador da operação em uma única transação D1.
5. O cliente confirma a revisão e busca mudanças pelo cursor incremental.

O `batch()` do D1 executa as instruções sequencialmente e atomicamente, então a nota, o histórico e o recibo da operação não ficam parcialmente gravados ([documentação do D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)).

## Como tratamos corridas

- **Duas abas do mesmo aparelho:** o cliente usa Web Locks quando disponível. Se uma operação antiga ainda chegar ao Worker, ele verifica quem gravou a revisão atual e a rebaseia quando veio do mesmo `deviceId`. Isso cobre abas antigas e evita criar uma nota de conflito para cada pedaço digitado. A API de Web Locks coordena páginas e workers na mesma origem ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)).
- **Dois aparelhos:** a revisão funciona como compare-and-swap. Se outro aparelho atualizou a mesma nota, o cliente preserva o texto concorrente em uma nota de recuperação e passa a seguir a revisão remota. Repetições do mesmo conflito durante uma edição não criam cópias extras.
- **Reenvio após rede instável:** o cliente pode reenviar uma operação; `opId` faz o Worker responder com o recibo já registrado em vez de aplicar duas vezes.
- **Atualização do PWA:** quando um novo Worker ativa, ele recarrega abas já abertas após uma pausa curta. Isso impede uma página antiga de continuar usando um protocolo de sincronização anterior.

## Tradeoffs

O five mantém sincronização direta entre cliente e Worker. Para três aparelhos e notas pessoais, uma fila externa adicionaria atraso e configuração sem resolver concorrência; a fila local já mantém as edições offline até poder enviá-las. Não prometemos entrega de rede “exactly once”: usamos reenvio idempotente e revisões para chegar a um estado consistente.

Em uma corrida no mesmo aparelho, vence a última operação aceita pelo servidor e a edição local mais recente continua na fila para ser enviada em seguida. Em uma corrida entre aparelhos, guardamos a versão concorrente para não descartar texto silenciosamente.
