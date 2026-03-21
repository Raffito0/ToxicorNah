# Interview Transcript: Production Integration

## Q1: Post failure handling
**Q**: Quando il bot posta un video e il post fallisce (errore TikTok, upload stuck, app crash), cosa deve succedere?
**A**: Retry nella stessa sessione (max 2). Se fallisce ancora salva come draft.

## Q2: Telegram monitoring level
**Q**: Per il monitoring Telegram, che livello di dettaglio vuoi?
**A**: Ogni sessione (start + result). Notifica quando ogni sessione inizia e quando finisce con risultato.

## Q3: Execution model
**Q**: Il bot girerà su un PC sempre acceso o lo lanci manualmente?
**A**: PC sempre acceso. Dashboard web accessibile via localhost per gestire tutto (add phones/accounts, set actions, weekly/daily plan). Prima volta avvio manuale dalla dashboard, poi rimane attivo. L'automazione deve essere sempre attiva — i telefoni seguono i weekly plans automaticamente. Se aggiungo nuovi telefoni dopo 1 settimana, devono entrare nel flusso automaticamente in warmup mode. Nella dashboard ogni account dovrebbe mostrare se è in warmup (scompare quando finisce).

## Q4: USB setup
**Q**: I 3 telefoni saranno sempre collegati via USB?
**A**: Sempre collegati (hub USB fisso).

## Q5: Dashboard esistente
**Q**: La dashboard Instagram esiste già? Stack?
**A**: Esiste già — software Instagram sviluppato dal developer. TikTok in sviluppo (lo sta facendo da solo). Prossimamente da integrare TikTok sulla dashboard.

## Q6: New phone onboarding
**Q**: Quando aggiungi un nuovo telefono, quali info inserisci?
**A**: Da analizzare nel codebase esistente per capire il flusso attuale.

## Q7: Proxy scaling
**Q**: Il proxy supporta più di 3 telefoni?
**A**: Ogni 4 telefoni circa serve un nuovo proxy. Nella dashboard ogni account dovrebbe avere un dropdown per selezionare il proxy da usare. Multipli proxy supportati.

## Q8: Content Library buffer
**Q**: Soglia minima video prima dell'alert?
**A**: 7 giorni (14 video per phone). Alert Telegram + skip post quando scende sotto.

## Q9: Cross-platform captions
**Q**: Caption diverso per TikTok e IG?
**A**: Identico — stesso caption su entrambe le piattaforme.

## Key Design Decisions

1. **Always-on automation**: Il bot è un servizio che gira 24/7, non un job lanciato a mano
2. **Dynamic phone onboarding**: Nuovi telefoni entrano in warmup automaticamente, senza riavviare il sistema
3. **Multi-proxy**: 1 proxy ogni ~4 telefoni, selezionabile per account dalla dashboard
4. **Dashboard-driven**: Tutto gestito dalla dashboard web (Flask), non da CLI
5. **Conservative stock buffer**: 7 giorni (14 video) minimo prima dell'alert
6. **Retry-then-draft**: 2 tentativi di post, poi draft + Telegram alert
