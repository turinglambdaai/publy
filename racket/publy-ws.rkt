#lang racket/base

;; Publy event gateway — live WebSocket push over the audit trail.
;;
;; Sits NEXT TO the publishing server, never inside it: the fastify
;; server keeps writing dataDir/history.jsonl exactly as before, and
;; this process tails that file and pushes each event to authenticated
;; WebSocket subscribers. The publishing server itself is untouched.
;;
;; Auth mirrors the HTTP API:
;;   admin key (server.json apiKey) → every event
;;   user key (publy_…)             → events for owned accounts plus
;;                                    rows carrying the user's contact;
;;                                    resolved read-only from users.db
;;
;; Credentials travel as ws://host:port/events?key=<credential>. Two
;; credential forms:
;;   - short-lived signed ticket (preferred, #8): POST /v1/ws-ticket on the
;;     server exchanges the header-authenticated key for
;;     "ws1.<exp36>.<identity>.<hmac-sha256>" — the long-lived key never
;;     appears in a URL. Verified against server.json's secretKey.
;;   - the long-lived key itself (legacy): rejected when the server.json
;;     flag wsRequireTickets is true.
;;
;; A fresh subscriber first receives a replay of the most recent events
;; (filtered), then {"control":"replay-done"}, then everything appended
;; live as JSON lines.

(require racket/async-channel
         racket/contract
         racket/file
         racket/list
         racket/path
         racket/port
         racket/string
         racket/tcp
         json
         db
         openssl
         websocket
         "publy-crypto.rkt")

(provide (contract-out
          [struct gateway-config ((api-key string?)
                                  (data-dir path-string?)
                                  (port exact-nonnegative-integer?)
                                  (secret-key (or/c string? #f))
                                  (require-tickets? boolean?))]
          [load-config
           (->* () ((or/c path-string? #f) (or/c exact-nonnegative-integer? #f))
                gateway-config?)]
          [ticket-identity
           (-> gateway-config? string? (or/c string? #f))]
          [authenticate
           (-> gateway-config? (or/c string? #f)
               (values (or/c 'admin 'user 'denied) (or/c string? #f)
                       (or/c (listof string?) #f)))]
          [event-matches? (-> hash? (or/c string? #f) (listof string?) boolean?)]
          [event-visible?
           (-> symbol? (or/c string? #f) (or/c (listof string?) #f) hash? boolean?)]
          [recent-events (-> gateway-config? exact-nonnegative-integer? (listof hash?))]
          [gateway? (-> any/c boolean?)]
          [make-gateway (-> gateway-config? gateway?)]
          [serve-gateway!
           (->* (gateway?) (#:port exact-nonnegative-integer?)
                (values exact-nonnegative-integer? thread?))]))

;; ---- configuration ---------------------------------------------------------

(struct gateway-config (api-key data-dir port secret-key require-tickets?) #:transparent)

(define (load-config [config-path #f] [port-override #f])
  (define file
    (or config-path
        (getenv "PUBLY_SERVER_CONFIG")
        (build-path (find-system-path 'home-dir) ".publy" "server.json")))
  (define raw
    (with-handlers ([exn:fail? (λ (_) (error 'publy-ws "cannot read server config: ~a" file))])
      (call-with-input-file file read-json)))
  (define api-key
    (or (and (hash? raw) (hash-ref raw 'apiKey #f))
        (error 'publy-ws "server config ~a is missing \"apiKey\"" file)))
  (define dir
    (or (and (hash? raw) (hash-ref raw 'dataDir #f))
        (path->string (build-path (simple-form-path file) "up" "server-data"))))
  (define http-port (and (hash? raw) (hash-ref raw 'port 8081)))
  (define port
    (or port-override
        (let ([env (getenv "PUBLY_WS_PORT")])
          (and env (string->number env)))
        (and (hash? raw) (hash-ref raw 'wsPort #f))
        (+ (if (number? http-port) http-port 8081) 1)))
  (gateway-config api-key dir port
                  (and (hash? raw) (hash-ref raw 'secretKey #f))
                  (and (hash? raw) (hash-ref raw 'wsRequireTickets #f))))

;; ---- ticket verification ----------------------------------------------------

;; base36 decode (string->number has no radix 36); input is regex-validated
;; as [a-z0-9]+ before this is called
(define (base36->number s)
  (for/fold ([acc 0]) ([c (in-string s)])
    (+ (* acc 36)
       (- (char->integer c)
          (if (char<=? #\0 c #\9) 48 87)))))

;; matches the fastify signWsTicket format: "ws1.<exp36>.<identity>.<hex mac>"
;; with mac = HMAC-SHA256(secretKey, "ws-ticket:<exp>:<identity>"); the
;; identity charset keeps the four-dot split unambiguous
(define (ticket-identity config credential)
  (define secret (gateway-config-secret-key config))
  (define parts (and credential (string-split credential ".")))
  (cond
    [(not (and secret parts (= (length parts) 4)
               (string=? (list-ref parts 0) "ws1")))
     #f]
    [(not (regexp-match? #rx"^[a-z0-9]+$" (list-ref parts 1))) #f]
    [(not (regexp-match? #rx"^[A-Za-z0-9:-]+$" (list-ref parts 2))) #f]
    [(not (regexp-match? #px"^[0-9a-f]{64}$" (list-ref parts 3))) #f]
    [else
     (define exp (list-ref parts 1))
     (define identity (list-ref parts 2))
     (define expected
       (hmac-sha256 (string->bytes/utf-8 secret)
                    (string->bytes/utf-8 (format "ws-ticket:~a:~a" exp identity))))
     (define exp-ms (* 1000 (base36->number exp)))
     (cond
       [(< exp-ms (current-inexact-milliseconds)) #f]
       [(not (string=? expected (list-ref parts 3))) #f]
       [else identity])]))

;; ---- authentication ---------------------------------------------------------

;; → (values 'admin #f #f) | (values 'user contact owned-names) | (values 'denied #f #f)
;; read-only over the same users.db the server writes; AppSecret columns
;; are never selected
(define (authenticate config credential)
  (cond
    [(not credential) (values 'denied #f #f)]
    ;; ticket path: identity is "admin" or "user:<id>"; the id is resolved
    ;; through the same users.db snapshot as key auth
    [(string-prefix? credential "ws1.")
     (define identity (ticket-identity config credential))
     (cond
       [(not identity) (values 'denied #f #f)]
       [(string=? identity "admin") (values 'admin #f #f)]
       [(string-prefix? identity "user:")
        (lookup-user-by-id config (substring identity 5))]
       [else (values 'denied #f #f)])]
    ;; legacy long-lived key in the URL — retired via wsRequireTickets
    [(gateway-config-require-tickets? config) (values 'denied #f #f)]
    [(string=? credential (gateway-config-api-key config))
     (values 'admin #f #f)]
    [else
     (lookup-user-by-key config credential)]))

(define (with-user-db config proc)
  (define db-file (build-path (gateway-config-data-dir config) "users.db"))
  (with-handlers ([exn:fail? (λ (_) (values 'denied #f #f))])
    (define dbc (sqlite3-connect #:database db-file #:mode 'read-only))
    (begin0 (proc dbc) (disconnect dbc))))

(define (lookup-user-by-key config key)
  (with-user-db config
    (λ (dbc)
      (define row
        (query-maybe-row
         dbc "select id, contact, disabled_at from users where api_key = ?" key))
      (cond
        [(not row) (values 'denied #f #f)]
        [(> (if (sql-null? (vector-ref row 2)) 0 (vector-ref row 2)) 0)
         (values 'denied #f #f)]
        [else
         (define contact (vector-ref row 1))
         (define accounts
           (query-list dbc
                       "select name from accounts where owner_user_id = ?"
                       (vector-ref row 0)))
         (values 'user contact accounts)]))))

(define (lookup-user-by-id config id)
  (with-user-db config
    (λ (dbc)
      (define row
        (query-maybe-row
         dbc "select id, contact, disabled_at from users where id = ?" id))
      (cond
        [(not row) (values 'denied #f #f)]
        [(> (if (sql-null? (vector-ref row 2)) 0 (vector-ref row 2)) 0)
         (values 'denied #f #f)]
        [else
         (define contact (vector-ref row 1))
         (define accounts
           (query-list dbc
                       "select name from accounts where owner_user_id = ?"
                       (vector-ref row 0)))
         (values 'user contact accounts)]))))

;; ---- event filtering ---------------------------------------------------------

;; a user subscriber sees an event when it names one of their accounts,
;; or carries their contact (orders, binds) or their user marker
;; (published/failed record `user` = contact for user keys)
(define (event-matches? event contact accounts)
  (or (and (member (hash-ref event 'account #f) accounts) #t)
      (equal? (hash-ref event 'contact #f) contact)
      (equal? (hash-ref event 'user #f) contact)))

(define (event-visible? kind contact accounts event)
  (or (eq? kind 'admin)
      (event-matches? event contact accounts)))

;; ---- subscribers -------------------------------------------------------------

(struct gateway (cfg subs-box lock))

(struct sub (conn kind contact accounts channel cleanup))

(define (make-gateway config)
  (gateway config (box null) (make-semaphore 1)))

(define (gateway-add! g s)
  (call-with-semaphore
   (gateway-lock g)
   (λ () (set-box! (gateway-subs-box g) (cons s (unbox (gateway-subs-box g)))))))

(define (gateway-remove! g s)
  (call-with-semaphore
   (gateway-lock g)
   (λ () (set-box! (gateway-subs-box g) (remq s (unbox (gateway-subs-box g)))))))

(define (gateway-broadcast! g event)
  (for ([s (in-list (unbox (gateway-subs-box g)))])
    (when (event-visible? (sub-kind s) (sub-contact s) (sub-accounts s) event)
      (async-channel-put (sub-channel s) (jsexpr->string event)))))

;; one writer thread per subscriber: the tail loop only does non-blocking
;; channel puts, so a slow client can never stall the file tail
(define (writer-loop conn ch cleanup)
  (let loop ()
    (define msg (sync/timeout 30 ch))
    (cond
      [(not msg)
       ;; idle keepalive — nobody reads this side, an outbound ping turns
       ;; half-open sockets into a visible write error
       (with-handlers ([exn:fail? (λ (_) (cleanup))])
         (ws-ping! conn))
       (loop)]
      [(eq? msg 'stop)
       (with-handlers ([exn:fail? void]) (ws-close! conn))
       (cleanup)]
      [else
       (with-handlers ([exn:fail? (λ (_) (cleanup))])
         (ws-send-text! conn msg))
       (loop)])))

;; ---- history tailing ---------------------------------------------------------

(define (history-path config)
  (build-path (gateway-config-data-dir config) "history.jsonl"))

(define (string->event s)
  (with-handlers ([exn:fail? (λ (_) (hash))])
    (read-json (open-input-string s))))

(define (drop-empties ls)
  (filter (λ (s) (not (string=? s ""))) ls))

;; last count events, oldest first; missing file → empty
(define (recent-events config count)
  (define hist (history-path config))
  (with-handlers ([exn:fail? (λ (_) '())])
    (define lines
      (call-with-input-file hist
        (λ (in)
          (define size (file-size hist))
          (when (> size 131072) (file-position in (- size 131072)))
          (drop-empties
           (string-split (bytes->string/utf-8 (port->bytes in)) "\n")))))
    (map string->event (take-right lines (min count (length lines))))))

;; live tail: poll for growth (APFS dir mtimes are unreliable; byte size
;; is not), parse complete lines only, leave a trailing partial line parked
(define (tail-loop! g)
  (define hist (history-path (gateway-cfg g)))
  (let loop ([offset
              (with-handlers ([exn:fail? (λ (_) 0)]) (file-size hist))])
    (sleep 0.8)
    (define size
      (with-handlers ([exn:fail? (λ (_) offset)]) (file-size hist)))
    (define next
      (if (> size offset)
          (with-handlers ([exn:fail? (λ (_) offset)])
            (call-with-input-file hist
              (λ (in)
                (file-position in offset)
                (define bs (port->bytes in))
                (define last-nl
                  (let scan ([i (sub1 (bytes-length bs))])
                    (cond [(< i 0) #f]
                          [(eqv? (bytes-ref bs i) 10) i]
                          [else (scan (sub1 i))])))
                (define complete
                  (if last-nl (subbytes bs 0 (add1 last-nl)) #""))
                (for ([l (in-list
                          (drop-empties
                           (string-split (bytes->string/utf-8 complete)
                                         "\n")))])
                  (gateway-broadcast! g (string->event l)))
                (+ offset (bytes-length complete)))))
          offset))
    (loop next)))

;; ---- connection handling -----------------------------------------------------

(define (key-from-path path)
  (and path
       (let ([m (regexp-match #rx"^/events\\?key=([^&]+)" path)])
         (and m (cadr m)))))

(define (close-ports in out)
  (with-handlers ([exn:fail? void])
    (unless (port-closed? in) (close-input-port in))
    (unless (port-closed? out) (close-output-port out))))

(define (handle-connection! g in out)
  (with-handlers
      ([exn:fail? (λ (_) (close-ports in out))])
    (define req (ws-read-upgrade-request! in))
    (define key (key-from-path (ws-upgrade-path req)))
    (define-values (kind contact accounts) (authenticate (gateway-cfg g) key))
    (cond
      [(eq? kind 'denied)
       ;; legacy key while tickets are required gets its own code so clients
       ;; know to switch to POST /v1/ws-ticket instead of re-sending the key
       (define body
         (if (and (gateway-config-require-tickets? (gateway-cfg g))
                  (not (and key (string-prefix? key "ws1."))))
             "{\"code\":\"TICKETS_REQUIRED\"}"
             "{\"code\":\"UNAUTHORIZED\"}"))
       (with-handlers ([exn:fail? void])
         (fprintf out "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ~a\r\n\r\n~a"
                  (string-length body) body)
         (flush-output out))
       (close-ports in out)]
      [else
       (define conn (ws-adopt in out (ws-upgrade-header req "sec-websocket-key")))
       (define ch (make-async-channel))
       (define (cleanup)
         (gateway-remove! g s)
         (async-channel-put ch 'stop))
       (define s
         (sub conn kind contact accounts ch
              (thread (λ () (writer-loop conn ch
                                         (λ () (gateway-remove! g s)))))))
       (gateway-add! g s)
       ;; replay: recent context first, then an explicit boundary so
       ;; clients know when live delivery begins — without it the two
       ;; are indistinguishable
       (for ([event (in-list (recent-events (gateway-cfg g) 200))])
         (when (event-visible? kind contact accounts event)
           (async-channel-put ch (jsexpr->string event))))
       (async-channel-put
        ch (jsexpr->string (hasheq 'control "replay-done")))])))

;; ---- accept loop --------------------------------------------------------------

(define (pick-port want)
  (if (zero? want)
      (let loop ([tries 10])
        (define p (+ 21000 (random 20000)))
        (with-handlers
            ([exn:fail:network? (λ (_)
                                  (when (zero? tries)
                                    (error 'publy-ws "no free port"))
                                  (loop (sub1 tries)))])
          (define l (tcp-listen p 16 #t "127.0.0.1"))
          (values l p)))
      (values (tcp-listen want 16 #t "0.0.0.0") want)))

(define (serve-gateway! g #:port [port (gateway-config-port (gateway-cfg g))])
  (define-values (listener real-port) (pick-port port))
  (define accept-thread
    (thread
     (λ ()
       (let loop ()
         (with-handlers ([exn:fail? (λ (_) (void))])
           (define-values (in out) (tcp-accept listener))
           (thread (λ () (handle-connection! g in out))))
         (loop)))))
  (define tailer (thread (λ () (tail-loop! g))))
  (values real-port (thread (λ () (sync accept-thread tailer)))))

;; ---- main ---------------------------------------------------------------------

(module+ main
  (require racket/cmdline)
  (define config-path
    (command-line
     #:program "publy-ws"
     #:once-each
     ["--config" c "path to server.json" c]
     #:args () #f))
  (define config (load-config config-path))
  (define g (make-gateway config))
  (define-values (port _supervisor) (serve-gateway! g))
  (printf "publy-ws: events on ws://0.0.0.0:~a/events (history at ~a)\n"
          port (history-path config))
  (flush-output)
  (sync never-evt))
