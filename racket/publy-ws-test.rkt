#lang racket/base

;; publy-ws tests: auth levels, tenant filtering, replay, and live tail
;; against a real gateway on 127.0.0.1 with real WebSocket clients.

(require rackunit
         racket/file
         racket/list
         racket/math
         racket/port
         racket/string
         racket/tcp
         json
         db
         websocket
         "publy-ws.rkt"
         "publy-crypto.rkt")

(define (string->jsexpr bs)
  (read-json (open-input-string (bytes->string/utf-8 bs))))

(define ADMIN-KEY "admin-test-key")
(define USER-KEY "publy_user_secret_42")
(define OTHER-KEY "publy_other_999")
(define WS-SECRET "ws-gateway-test-secret")

;; mirrors the fastify signWsTicket format, against the test secret
;; (number->string has no radix 36; encode manually)
(define (base36 n)
  (let loop ([n n] [acc '()])
    (if (< n 36)
        (list->string (cons (string-ref "0123456789abcdefghijklmnopqrstuvwxyz" n) acc))
        (loop (quotient n 36)
              (cons (string-ref "0123456789abcdefghijklmnopqrstuvwxyz" (remainder n 36)) acc)))))

(define (sign-ticket exp-ms identity [secret WS-SECRET])
  (define exp (base36 (exact-floor (/ exp-ms 1000))))
  (define mac (hmac-sha256 (string->bytes/utf-8 secret)
                           (string->bytes/utf-8 (format "ws-ticket:~a:~a" exp identity))))
  (format "ws1.~a.~a.~a" exp identity mac))

;; ---- tickets -----------------------------------------------------------------

(module+ test
  (define config-t (gateway-config ADMIN-KEY (make-temporary-file "publy-ws-t-~a" 'directory) 0 WS-SECRET #f))

  (check-equal? (ticket-identity config-t (sign-ticket (+ (current-inexact-milliseconds) 60000) "admin")) "admin")
  (check-equal? (ticket-identity config-t (sign-ticket (+ (current-inexact-milliseconds) 60000) "user:u1")) "user:u1")
  ;; expired
  (check-false (ticket-identity config-t (sign-ticket (- (current-inexact-milliseconds) 5000) "admin")))
  ;; wrong secret
  (check-false (ticket-identity config-t (sign-ticket (+ (current-inexact-milliseconds) 60000) "admin" "other-secret")))
  ;; tampered mac / garbage shapes
  (check-false (ticket-identity config-t "ws1.abc.admin.deadbeef"))
  (check-false (ticket-identity config-t "not-a-ticket"))
  (check-false (ticket-identity config-t "ws1.!!!---.admin.ok"))
  ;; gateway without a secret rejects all tickets
  (check-false (ticket-identity (gateway-config ADMIN-KEY (make-temporary-file "publy-ws-t2-~a" 'directory) 0 #f #f)
                                (sign-ticket (+ (current-inexact-milliseconds) 60000) "admin"))))

(module+ test
  ;; ticket auth end-to-end: a user ticket carries the same visibility as the key
  (define dir-tk (make-fixture!))
  (define config-tk (gateway-config ADMIN-KEY dir-tk 0 WS-SECRET #f))
  (define g-tk (make-gateway config-tk))
  (define-values (port-tk _supervisor-tk) (serve-gateway! g-tk #:port 0))
  ;; admin ticket sees everything
  (define admin-t (connect-events port-tk (sign-ticket (+ (current-inexact-milliseconds) 60000) "admin")))
  (check-equal? (hash-ref (recv-event admin-t 5 "ticket admin replay") 'event) "published")
  ;; user ticket for u1 (alice) sees her account + contact rows only
  (define user-t (connect-events port-tk (sign-ticket (+ (current-inexact-milliseconds) 60000) "user:u1")))
  (define ut1 (recv-event user-t 5 "ticket user replay"))
  (check-equal? (hash-ref ut1 'account) "my-account")
  (check-equal? (hash-ref (recv-event user-t 5 "ticket user replay 2") 'event) "purchase-paid")
  (check-equal? (hash-ref (recv-event user-t 5 "ticket user replay-done") 'control) "replay-done")
  ;; unknown user id in a valid ticket → denied
  (check-exn exn:fail:websocket?
             (λ () (connect-events port-tk (sign-ticket (+ (current-inexact-milliseconds) 60000) "user:ghost"))))
  ;; expired ticket → denied
  (check-exn exn:fail:websocket?
             (λ () (connect-events port-tk (sign-ticket (- (current-inexact-milliseconds) 5000) "admin")))))

(module+ test
  ;; wsRequireTickets retires the legacy key-in-URL path
  (define dir3 (make-fixture!))
  (define config3 (gateway-config ADMIN-KEY dir3 0 WS-SECRET #t))
  (define g3 (make-gateway config3))
  (define-values (port3 _supervisor3) (serve-gateway! g3 #:port 0))
  ;; even the admin key is refused now
  (check-exn exn:fail:websocket? (λ () (connect-events port3 ADMIN-KEY)))
  ;; a valid ticket still works
  (define admin-t3 (connect-events port3 (sign-ticket (+ (current-inexact-milliseconds) 60000) "admin")))
  (check-equal? (hash-ref (recv-event admin-t3 5 "tickets-only admin replay") 'event) "published"))

;; ---- fixture: data dir with users.db + history.jsonl ------------------------

(define (make-fixture!)
  (define dir (make-temporary-file "publy-ws-~a" 'directory))
  (define dbc (sqlite3-connect #:database (build-path dir "users.db") #:mode 'create))
  (query-exec dbc
              "create table users (id text primary key, contact text not null unique, api_key text not null unique, disabled_at integer not null default 0)")
  (query-exec dbc
              "create table accounts (name text primary key, app_id text not null, app_secret text not null, owner_user_id text)")
  (query-exec dbc
              "insert into users (id, contact, api_key) values ('u1', 'alice@example.com', ?)" USER-KEY)
  (query-exec dbc
              "insert into users (id, contact, api_key) values ('u2', 'bob@example.com', ?)" OTHER-KEY)
  (query-exec dbc
              "insert into accounts (name, app_id, app_secret, owner_user_id) values ('my-account', 'wx111', 'sec', 'u1')")
  (disconnect dbc)
  (call-with-output-file (build-path dir "history.jsonl")
    (λ (out)
      (fprintf out "~a\n"
               (jsexpr->string (hasheq 'event "published" 'account "my-account"
                                       'title "old post" 'user "alice@example.com")))
      (fprintf out "~a\n"
               (jsexpr->string (hasheq 'event "published" 'account "admin-account"
                                       'title "admin post" 'user "admin")))
      (fprintf out "~a\n"
               (jsexpr->string (hasheq 'event "purchase-paid" 'contact "alice@example.com"
                                       'orderId "o1"))))
    #:exists 'truncate)
  dir)

;; ---- helpers ----------------------------------------------------------------

;; #f on timeout (quiet-period assertions), error message preserved on exn
(define (recv/timeout conn secs what)
  (define ch (make-channel))
  (define t
    (thread
     (λ ()
       (channel-put ch
                    (with-handlers
                        ([exn:fail? (λ (e) (vector 'exn (exn-message e)))])
                      (ws-recv conn))))))
  (or (sync/timeout secs ch)
      (begin (kill-thread t) #f)))

(define (recv-event conn secs what)
  (define m (recv/timeout conn secs what))
  (unless (and (ws-message? m) (not (vector? m)))
    (error 'recv-event "no message for ~a: ~a" what m))
  (read-json (open-input-string (bytes->string/utf-8 (ws-message-payload m)))))

(define (append-event! dir h)
  (call-with-output-file (build-path dir "history.jsonl")
    (λ (out) (fprintf out "~a\n" (jsexpr->string h)))
    #:exists 'append))

(define (connect-events port key)
  (ws-connect (format "ws://127.0.0.1:~a/events?key=~a" port key)))

;; ---- pure filtering ---------------------------------------------------------

(module+ test
  (check-true (event-matches? (hasheq 'event "published" 'account "my-account")
                              "alice@x" (list "my-account")))
  (check-false (event-matches? (hasheq 'event "published" 'account "other")
                               "alice@x" (list "my-account")))
  (check-true (event-matches? (hasheq 'event "purchase-paid" 'contact "alice@x")
                              "alice@x" (list "my-account")))
  (check-true (event-matches? (hasheq 'event "published" 'account "zzz" 'user "alice@x")
                              "alice@x" (list "my-account")))
  (check-false (event-matches? (hasheq 'event "published" 'account "zzz" 'user "bob@x")
                               "alice@x" (list "my-account"))))

(module+ test
  ;; ---- auth + replay + live tail -------------------------------------------
  (define dir (make-fixture!))
  (define config (gateway-config ADMIN-KEY dir 0 #f #f))
  (define g (make-gateway config))
  (define-values (port _supervisor) (serve-gateway! g #:port 0))

  ;; unknown key is rejected at the HTTP layer
  (check-exn exn:fail:websocket?
             (λ () (connect-events port "publy_nope")))  ;; wrong path too
  (check-exn exn:fail:websocket?
             (λ () (ws-connect (format "ws://127.0.0.1:~a/other?key=~a" port ADMIN-KEY))))

  ;; admin sees the full replay
  (define admin (connect-events port ADMIN-KEY))
  (define a1 (recv-event admin 5 "admin replay 1"))
  (check-equal? (hash-ref a1 'event) "published")
  (check-equal? (hash-ref a1 'account) "my-account")
  (define a2 (recv-event admin 5 "admin replay 2"))
  (check-equal? (hash-ref a2 'account) "admin-account")
  (define a3 (recv-event admin 5 "admin replay 3"))
  (check-equal? (hash-ref a3 'event) "purchase-paid")
  (check-equal? (hash-ref (recv-event admin 5 "admin replay-done") 'control)
                "replay-done")

  ;; user sees only their own account + contact rows in replay
  (define user (connect-events port USER-KEY))
  (define u1 (recv-event user 5 "user replay"))
  (check-equal? (hash-ref u1 'account) "my-account")
  (define u2 (recv-event user 5 "user replay 2"))
  (check-equal? (hash-ref u2 'event) "purchase-paid")
  ;; exactly two events, then the boundary — nothing else in replay
  (check-equal? (hash-ref (recv-event user 5 "user replay-done") 'control)
                "replay-done")
  (check-false (recv/timeout user 1 "user should be quiet here"))

  ;; live tail: appended events flow to both, user still filtered
  (append-event! dir (hasheq 'event "failed" 'account "my-account" 'title "their post"))
  (define a4 (recv-event admin 5 "admin live"))
  (check-equal? (hash-ref a4 'event) "failed")
  (define u3 (recv-event user 5 "user live"))
  (check-equal? (hash-ref u3 'account) "my-account")

  (append-event! dir (hasheq 'event "published" 'account "admin-account" 'user "admin"))
  (define a5 (recv-event admin 5 "admin live 2"))
  (check-equal? (hash-ref a5 'account) "admin-account")
  (check-false (recv/timeout user 1.5 "user must not see other users' accounts"))

  ;; second user with no matching ownership sees only their contact rows
  (define bob (connect-events port OTHER-KEY))
  ;; drain until the marker: a user with no ownership must see zero
  ;; replayed data events
  (let drain ()
    (define m (recv/timeout bob 5 "bob marker"))
    (unless (and (ws-message? m) (not (vector? m))
                 (equal? (hash-ref (string->jsexpr (ws-message-payload m))
                                   'control #f)
                         "replay-done"))
      (check-false m "bob must see no replay data")
      (when m (drain))))
  (append-event! dir (hasheq 'event "purchase-paid" 'contact "bob@example.com" 'orderId "o2"))
  (define b1 (recv-event bob 5 "bob live"))
  (check-equal? (hash-ref b1 'contact) "bob@example.com")

  ;; admin also received bob's o2 (admin sees everything) — consume it
  (check-equal? (hash-ref (recv-event admin 5 "admin sees o2") 'orderId) "o2")

  ;; partial line parked, not broadcast until complete
  (call-with-output-file (build-path dir "history.jsonl")
    (λ (out) (display "{\"event\":\"scheduled\",\"acc" out))
    #:exists 'append)
  (check-false (recv/timeout admin 1.5 "partial line must stay parked"))
  (call-with-output-file (build-path dir "history.jsonl")
    (λ (out) (display "ount\":\"my-account\"}\n" out))
    #:exists 'append)
  (define a6 (recv-event admin 5 "admin live after partial completes"))
  (check-equal? (hash-ref a6 'event) "scheduled")
  (define u4 (recv-event user 5 "user live after partial completes"))
  (check-equal? (hash-ref u4 'account) "my-account")
  ;; by now the only event that could ever reach bob is his own o2 —
  ;; nothing else may have arrived
  (check-false (recv/timeout bob 1.5 "bob filtered from everything else")))

;; disabled users are denied
(module+ test
  (define dir2 (make-fixture!))
  (define dbc (sqlite3-connect #:database (build-path dir2 "users.db")))
  (query-exec dbc "update users set disabled_at = 1 where api_key = ?" USER-KEY)
  (disconnect dbc)
  (define config2 (gateway-config ADMIN-KEY dir2 0 #f #f))
  (define g2 (make-gateway config2))
  (define-values (port2 _) (serve-gateway! g2 #:port 0))
  (check-exn exn:fail:websocket? (λ () (connect-events port2 USER-KEY))))
