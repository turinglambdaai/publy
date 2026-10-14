#lang racket/base

;; Publy stats — read-only operational statistics over the same data plane
;; the fastify server writes (dataDir/users.db + dataDir/history.jsonl).
;;
;; Same posture as publy-ws: sits NEXT TO the server, never inside it.
;; Opens users.db read-only, never selects app_secret or api_key, only
;; reads history.jsonl, and has zero dependency on @publy/core.
;;
;; Usage:
;;   racket racket/publy-stats.rkt [--config server.json] [--days N] [--json]
;;
;; Human report by default; --json emits one machine-readable object for
;; agents and dashboards. All day/month bucketing uses Asia/Shanghai wall
;; time (UTC+8, no DST), matching the server's month_key convention.

(require racket/contract
         racket/date
         racket/file
         racket/format
         racket/list
         racket/path
         racket/port
         racket/string
         json
         db)

(provide (contract-out
          [struct stats-config ((data-dir path-string?))]
          [load-config (->* () ((or/c path-string? #f)) stats-config?)]
          [read-history (-> path-string? (listof hash?))]
          [iso->shanghai-date (-> any/c (or/c string? #f))]
          [ms->shanghai-date (-> real? string?)]
          [ms->shanghai-month (-> real? string?)]
          [current-month-key (-> string?)]
          [window-dates (-> string? exact-nonnegative-integer? (listof string?))]
          [publish-outcomes (-> (listof hash?)
                                (values exact-nonnegative-integer?
                                        exact-nonnegative-integer?))]
          [daily-counts
           (-> (listof hash?) exact-nonnegative-integer? (-> hash? boolean?)
               (listof (cons/c string? exact-nonnegative-integer?)))]
          [error-histogram
           (-> (listof hash?) (listof (cons/c string? exact-nonnegative-integer?)))]
          [account-histogram
           (-> (listof hash?) (listof (cons/c string? exact-nonnegative-integer?)))]
          [user-stats (-> (listof hash?) real? hash?)]
          [near-limit-users
           (-> (listof hash?) string? (listof hash?))]
          [revenue-by-month
           (-> (listof hash?) (listof (cons/c string? exact-nonnegative-integer?)))]
          [collect-stats
           (-> stats-config? exact-nonnegative-integer? hash?)]
          [report->string (-> hash? string?)]))

;; ---- configuration ---------------------------------------------------------

(struct stats-config (data-dir) #:transparent)

(define (load-config [config-path #f])
  (define file
    (or config-path
        (getenv "PUBLY_SERVER_CONFIG")
        (build-path (find-system-path 'home-dir) ".publy" "server.json")))
  (define raw
    (with-handlers ([exn:fail? (λ (_) (error 'publy-stats "cannot read server config: ~a" file))])
      (call-with-input-file file read-json)))
  (define dir
    (or (and (hash? raw) (hash-ref raw 'dataDir #f))
        (path->string (build-path (simple-form-path file) "up" "server-data"))))
  (stats-config dir))

;; ---- time helpers (Asia/Shanghai = UTC+8 fixed, no DST) ---------------------

(define (pad2 n) (~r n #:min-width 2 #:pad-string "0"))

(define (ms->shanghai-date ms)
  (define d (seconds->date (+ (quotient ms 1000) 28800) #f))
  (~a (date-year d) "-" (pad2 (date-month d)) "-" (pad2 (date-day d))))

(define (ms->shanghai-month ms)
  (define d (seconds->date (+ (quotient ms 1000) 28800) #f))
  (~a (date-year d) "-" (pad2 (date-month d))))

(define (current-month-key)
  (ms->shanghai-month (* 1000 (current-seconds))))

(define iso-rx #px"^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})")

;; ISO-8601 UTC timestamp → Shanghai calendar date "YYYY-MM-DD",
;; #f when the line carries no parseable ts
(define (iso->shanghai-date s)
  (define m (and (string? s) (regexp-match iso-rx s)))
  (and m
       (ms->shanghai-date
        (* 1000
           (find-seconds (string->number (list-ref m 6))
                         (string->number (list-ref m 5))
                         (string->number (list-ref m 4))
                         (string->number (list-ref m 3))
                         (string->number (list-ref m 2))
                         (string->number (list-ref m 1))
                         #f)))))

;; every date in the N-day window ending at `today` ("YYYY-MM-DD"),
;; oldest first
(define (window-dates today days)
  (define parts (and (string? today) (string-split today "-")))
  (if (or (not parts) (not (= 3 (length parts))))
      '()
      (let ([e0 (find-seconds 0 0 0
                              (string->number (list-ref parts 2))
                              (string->number (list-ref parts 1))
                              (string->number (list-ref parts 0))
                              #f)])
        (for/list ([i (in-range (sub1 days) -1 -1)])
          (ms->shanghai-date (* 1000 (+ e0 28800 (- (* i 86400)))))))))

;; ---- history.jsonl ----------------------------------------------------------

(define (history-path config)
  (build-path (stats-config-data-dir config) "history.jsonl"))

;; whole audit trail, malformed lines skipped; missing file → empty
(define (read-history hist)
  (with-handlers ([exn:fail? (λ (_) '())])
    (filter
     hash?
     (map (λ (line)
            (with-handlers ([exn:fail? (λ (_) #f)])
              (read-json (open-input-string line))))
          (filter (λ (s) (not (string=? s "")))
                  (call-with-input-file hist port->lines))))))

;; ---- publish outcomes -------------------------------------------------------

(define published-kinds '("published" "scheduled-published"))
(define failed-kinds '("failed" "scheduled-failed"))

(define (event-kind-in? event kinds)
  (and (member (hash-ref event 'event #f) kinds) #t))

;; → (values published failed) over both direct and scheduled families
(define (publish-outcomes events)
  (values (count (λ (e) (event-kind-in? e published-kinds)) events)
          (count (λ (e) (event-kind-in? e failed-kinds)) events)))

;; per-day counts of events matching `keep?`, zero-filled across the
;; N-day Shanghai window ending today, oldest first
(define (daily-counts events days keep?)
  (define today (ms->shanghai-date (* 1000 (current-seconds))))
  ;; equal?-keyed: the bucket keys are freshly computed strings
  (define counts (make-hash))
  (for ([e (in-list events)])
    (define ts (hash-ref e 'ts #f))
    (define d (and (string? ts) (iso->shanghai-date ts)))
    (when (and d (keep? e))
      (hash-update! counts d add1 0)))
  (for/list ([d (in-list (window-dates today days))])
    (cons d (hash-ref counts d 0))))

;; top failing error messages, most frequent first
(define (error-histogram events)
  (define counts (make-hash))
  (for ([e (in-list events)] #:when (event-kind-in? e failed-kinds))
    (define err (hash-ref e 'error #f))
    (hash-update! counts (if (string? err) err "unknown") add1 0))
  (sort (hash->list counts) > #:key cdr))

;; successful publishes per account, most active first
(define (account-histogram events)
  (define counts (make-hash))
  (for ([e (in-list events)] #:when (event-kind-in? e published-kinds))
    (define acc (hash-ref e 'account #f))
    (when (string? acc)
      (hash-update! counts acc add1 0)))
  (sort (hash->list counts) > #:key cdr))

;; ---- users.db ---------------------------------------------------------------

(define (users-db-path config)
  (build-path (stats-config-data-dir config) "users.db"))

;; credential-free projections: api_key / app_secret are never selected
(define (read-users config)
  (with-handlers ([exn:fail? (λ (_) '())])
    (define dbc (sqlite3-connect #:database (users-db-path config) #:mode 'read-only))
    (begin0
      (for/list ([row (in-list (query-rows dbc
                                           "select contact, plan, publish_count, month_key, disabled_at, expires_at, created_at from users"))])
        (hasheq 'contact (vector-ref row 0)
                'plan (vector-ref row 1)
                'publish-count (vector-ref row 2)
                'month-key (vector-ref row 3)
                'disabled-at (vector-ref row 4)
                'expires-at (vector-ref row 5)
                'created-at (vector-ref row 6)))
      (disconnect dbc))))

(define (read-accounts config)
  (with-handlers ([exn:fail? (λ (_) '())])
    (define dbc (sqlite3-connect #:database (users-db-path config) #:mode 'read-only))
    (begin0
      (for/list ([row (in-list (query-rows dbc "select name, owner_user_id from accounts"))])
        (hasheq 'name (vector-ref row 0)
                'owner-user-id (let ([v (vector-ref row 1)])
                                 (if (sql-null? v) #f v))))
      (disconnect dbc))))

(define (read-orders config)
  (with-handlers ([exn:fail? (λ (_) '())])
    (define dbc (sqlite3-connect #:database (users-db-path config) #:mode 'read-only))
    (begin0
      (for/list ([row (in-list (query-rows dbc "select plan, months, amount_fen, status, paid_at from orders"))])
        (hasheq 'plan (vector-ref row 0)
                'months (vector-ref row 1)
                'amount-fen (vector-ref row 2)
                'status (vector-ref row 3)
                'paid-at (vector-ref row 4)))
      (disconnect dbc))))

;; plan limits mirror store.ts PLAN_LIMITS
(define plan-monthly-limit
  (λ (plan) (if (equal? plan "pro") 5000 30)))

(define (user-stats rows now-ms)
  (hasheq 'total (length rows)
          'active (count (λ (r) (zero? (hash-ref r 'disabled-at 0))) rows)
          'disabled (count (λ (r) (> (hash-ref r 'disabled-at 0) 0)) rows)
          'proActive
          (count (λ (r)
                   (and (equal? (hash-ref r 'plan) "pro")
                        (let ([exp (hash-ref r 'expires-at 0)])
                          (or (zero? exp) (> exp now-ms)))))
                 rows)
          'newLast7d
          (count (λ (r) (>= (hash-ref r 'created-at 0) (- now-ms 604800000))) rows)
          'proExpiring14d
          (count (λ (r)
                   (define exp (hash-ref r 'expires-at 0))
                   (and (equal? (hash-ref r 'plan) "pro")
                        (> exp now-ms)
                        (<= exp (+ now-ms 1209600000))))
                 rows)))

;; users inside 80% of this month's plan quota, heaviest first
(define (near-limit-users rows month-key)
  (define usage
    (filter
     (λ (r)
       (and (equal? (hash-ref r 'month-key) month-key)
            (>= (hash-ref r 'publish-count 0)
                (* 4/5 (plan-monthly-limit (hash-ref r 'plan))))))
     rows))
  (sort
   (for/list ([r (in-list usage)])
     (hasheq 'contact (hash-ref r 'contact)
             'plan (hash-ref r 'plan)
             'used (hash-ref r 'publish-count 0)
             'limit (plan-monthly-limit (hash-ref r 'plan))))
   > #:key (λ (r) (/ (hash-ref r 'used) (hash-ref r 'limit)))))

;; paid order revenue per Shanghai month, ascending
(define (revenue-by-month orders)
  (define totals (make-hash))
  (for ([o (in-list orders)]
        #:when (and (equal? (hash-ref o 'status) "paid")
                    (> (hash-ref o 'paid-at 0) 0)))
    (hash-update! totals
                  (ms->shanghai-month (hash-ref o 'paid-at))
                  (λ (n) (+ n (hash-ref o 'amount-fen 0)))
                  0))
  (sort (hash->list totals) string<? #:key car))

;; ---- aggregate ---------------------------------------------------------------

(define (pct part total)
  (if (zero? total)
      0.0
      (/ (round (* 10000.0 (/ part total))) 10000.0)))

(define (collect-stats config days)
  (define now-ms (* 1000 (current-seconds)))
  (define events (read-history (history-path config)))
  (define users (read-users config))
  (define accounts (read-accounts config))
  (define orders (read-orders config))
  (define-values (published failed) (publish-outcomes events))
  (define daily-pub (daily-counts events days (λ (e) (event-kind-in? e published-kinds))))
  (define daily-fail (daily-counts events days (λ (e) (event-kind-in? e failed-kinds))))
  (define errs (error-histogram events))
  (define top-errors (take errs (min 5 (length errs))))
  (hasheq
   'generatedAt (ms->shanghai-date now-ms)
   'windowDays days
   'users (user-stats users now-ms)
   'accounts
   (hasheq 'total (length accounts)
           'owned (count (λ (a) (hash-ref a 'owner-user-id #f)) accounts)
           'shared (count (λ (a) (not (hash-ref a 'owner-user-id #f))) accounts))
   'publishes
   (hasheq 'published published
           'failed failed
           'failureRate (pct failed (+ published failed))
           'perDay
           (for/list ([d (in-list (window-dates (ms->shanghai-date now-ms) days))])
             (hasheq 'date d
                     'published (cdr (assoc d daily-pub))
                     'failed (cdr (assoc d daily-fail))))
           'perAccount
           (for/list ([pair (in-list (account-histogram events))])
             (hasheq 'account (car pair) 'published (cdr pair))))
   'topErrors
   (for/list ([pair (in-list top-errors)])
     (hasheq 'error (car pair) 'count (cdr pair)))
   'nearLimit (near-limit-users users (current-month-key))
   'revenue
   (let ([paid (filter (λ (o) (equal? (hash-ref o 'status) "paid")) orders)])
     (hasheq 'paidFen (sum (map (λ (o) (hash-ref o 'amount-fen 0)) paid))
             'paidOrders (length paid)
             'pendingOrders (count (λ (o) (equal? (hash-ref o 'status) "pending")) orders)
             'byMonth
             (for/list ([pair (in-list (revenue-by-month orders))])
               (hasheq 'month (car pair) 'fen (cdr pair)))))))

;; ---- human report -------------------------------------------------------------

(define (bar count max-count width)
  (if (or (zero? max-count) (zero? count))
      ""
      (make-string (max 1 (inexact->exact (round (* width (/ count max-count))))) #\#)))

(define (sum ns) (foldl + 0 ns))

(define (report->string stats)
  (define out (open-output-string))
  (define (line . xs) (fprintf out "~a\n" (apply string-append (map ~a xs))))
  (define users (hash-ref stats 'users))
  (define accounts (hash-ref stats 'accounts))
  (define publishes (hash-ref stats 'publishes))
  (define days (hash-ref stats 'windowDays))

  (line "publy stats — " (hash-ref stats 'generatedAt) " (Asia/Shanghai), window " days "d")
  (line "")
  (line "users")
  (line "  total " (hash-ref users 'total)
        " · active " (hash-ref users 'active)
        " · disabled " (hash-ref users 'disabled)
        " · pro " (hash-ref users 'proActive)
        " · new 7d " (hash-ref users 'newLast7d)
        " · pro expiring 14d " (hash-ref users 'proExpiring14d))
  (line "accounts")
  (line "  total " (hash-ref accounts 'total)
        " · owned " (hash-ref accounts 'owned)
        " · shared " (hash-ref accounts 'shared))
  (line "publishes (" days "d)")
  (define daily (hash-ref publishes 'perDay))
  (define max-day
    (foldl (λ (d m) (max m (hash-ref d 'published) (hash-ref d 'failed))) 0 daily))
  (for ([d (in-list daily)])
    (line "  " (hash-ref d 'date) "  "
          (~a (hash-ref d 'published) #:min-width 5 #:align 'right)
          "  " (bar (hash-ref d 'published) max-day 36)
          (if (zero? (hash-ref d 'failed)) "" (format "  (failed ~a)" (hash-ref d 'failed)))))
  (line "  total " (hash-ref publishes 'published)
        " published · " (hash-ref publishes 'failed)
        " failed · " (* 100 (hash-ref publishes 'failureRate)) "% failure")
  (define per-account (hash-ref publishes 'perAccount))
  (unless (null? per-account)
    (line "  by account")
    (for ([a (in-list per-account)])
      (line "    " (hash-ref a 'account) ": " (hash-ref a 'published))))
  (define errors (hash-ref stats 'topErrors))
  (unless (null? errors)
    (line "top errors")
    (for ([e (in-list errors)])
      (line "  " (hash-ref e 'count) "x " (hash-ref e 'error))))
  (define near (hash-ref stats 'nearLimit))
  (unless (null? near)
    (line "near monthly limit (>=80%)")
    (for ([u (in-list near)])
      (line "  " (hash-ref u 'contact) " (" (hash-ref u 'plan) ") "
            (hash-ref u 'used) "/" (hash-ref u 'limit))))
  (define revenue (hash-ref stats 'revenue))
  (line "revenue")
  (line "  paid ¥" (/ (hash-ref revenue 'paidFen) 100)
        " across " (hash-ref revenue 'paidOrders) " orders · pending "
        (hash-ref revenue 'pendingOrders))
  (for ([m (in-list (take-right (hash-ref revenue 'byMonth)
                                (min 6 (length (hash-ref revenue 'byMonth)))))])
    (line "  " (hash-ref m 'month) "  ¥" (/ (hash-ref m 'fen) 100)))
  (get-output-string out))

;; ---- main ---------------------------------------------------------------------

(module+ main
  (require racket/cmdline)
  (define config-path (make-parameter #f))
  (define days (make-parameter 30))
  (define as-json? (make-parameter #f))
  (command-line
   #:program "publy-stats"
   #:once-each
   ["--config" c "path to server.json" (config-path c)]
   ["--days" d "publish window in days (default 30)" (days (or (string->number d) 30))]
   ["--json" "emit one JSON object instead of a report" (as-json? #t)])
  (define stats
    (collect-stats (load-config (config-path)) (max 1 (min 365 (days)))))
  (if (as-json?)
      (begin (write-json stats) (newline))
      (display (report->string stats))))

;; ---- tests ---------------------------------------------------------------------

(module+ test
  (require rackunit)

  ;; fixed "now" for deterministic assertions: 2026-10-14T12:00:00Z
  (define NOW-MS 1792363200000)

  (test-case "shanghai bucketing crosses the UTC day boundary"
    (check-equal? (iso->shanghai-date "2026-10-14T17:30:00.123Z") "2026-10-15")
    (check-equal? (iso->shanghai-date "2026-10-14T15:59:59Z") "2026-10-14")
    (check-equal? (iso->shanghai-date "not-a-ts") #f)
    (check-equal? (iso->shanghai-date #f) #f)
    (check-equal? (ms->shanghai-month 1792363200000) "2026-10")
    (check-equal? (current-month-key) (ms->shanghai-month (* 1000 (current-seconds)))))

  (test-case "window-dates is zero-filled and ordered oldest first"
    (define dates (window-dates "2026-10-14" 5))
    (check-equal? (length dates) 5)
    (check-equal? (car dates) "2026-10-10")
    (check-equal? (last dates) "2026-10-14")
    (check-equal? (window-dates "garbage" 5) '()))

  (define ev
    (λ (event ts . extra)
      (apply hasheq 'event event 'ts ts extra)))

  (test-case "publish outcomes count both direct and scheduled families"
    (define events
      (list (ev "published" "2026-10-14T01:00:00Z")
            (ev "scheduled-published" "2026-10-14T02:00:00Z")
            (ev "failed" "2026-10-14T03:00:00Z" 'error "boom")
            (ev "deduped" "2026-10-14T04:00:00Z")
            (ev "purchase-paid" "2026-10-14T05:00:00Z")))
    (define-values (pub fail) (publish-outcomes events))
    (check-equal? pub 2)
    (check-equal? fail 1))

  (test-case "daily counts bucket by Shanghai day and zero-fill"
    ;; build timestamps relative to the real today so the window anchor
    ;; can never drift away from the data
    (define (utc-iso ms)
      (define d (seconds->date (quotient ms 1000) #f))
      (~a (date-year d) "-" (pad2 (date-month d)) "-" (pad2 (date-day d))
          "T" (pad2 (date-hour d)) ":" (pad2 (date-minute d)) ":" (pad2 (date-second d)) "Z"))
    (define today (ms->shanghai-date (* 1000 (current-seconds))))
    (define parts (map string->number (string-split today "-")))
    (define midnight-utc
      (find-seconds 0 0 0 (caddr parts) (cadr parts) (car parts) #f))
    ;; Shanghai 09:00 = UTC 01:00
    (define sh-0900-today-ms (* 1000 (+ midnight-utc 3600)))
    (define sh-0900-next-ms  (* 1000 (+ midnight-utc 3600 86400)))
    (define sh-0900-yest-ms  (* 1000 (+ midnight-utc 3600 -86400)))
    (define events
      (list (ev "published" (utc-iso sh-0900-today-ms))
            ;; tomorrow in Shanghai already — lands outside the window
            (ev "published" (utc-iso sh-0900-next-ms))
            (ev "failed" (utc-iso sh-0900-yest-ms) 'error "x")))
    (define counts
      (daily-counts events 3 (λ (e) (event-kind-in? e published-kinds))))
    (define win (window-dates today 3))
    (check-equal? counts
                  (list (cons (list-ref win 0) 0)
                        (cons (list-ref win 1) 0)
                        (cons (list-ref win 2) 1)))
    (define fails
      (daily-counts events 3 (λ (e) (event-kind-in? e failed-kinds))))
    (check-equal? (cdr (assoc (list-ref win 1) fails)) 1))

  (test-case "error and account histograms rank most frequent first"
    (define events
      (list (ev "failed" "2026-10-14T01:00:00Z" 'error "40001 invalid credential")
            (ev "failed" "2026-10-14T02:00:00Z" 'error "40001 invalid credential")
            (ev "scheduled-failed" "2026-10-14T03:00:00Z" 'error "timeout")
            (ev "failed" "2026-10-14T04:00:00Z")
            (ev "published" "2026-10-14T05:00:00Z" 'account "a")
            (ev "scheduled-published" "2026-10-14T06:00:00Z" 'account "a")
            (ev "published" "2026-10-14T07:00:00Z" 'account "b")))
    (define hist (error-histogram events))
    ;; clear winner first; ties below it come out in hash order — assert
    ;; counts by lookup instead of exact ordering
    (check-equal? (car hist) (cons "40001 invalid credential" 2))
    (check-equal? (cdr (assoc "timeout" hist)) 1)
    (check-equal? (cdr (assoc "unknown" hist)) 1)
    (check-equal? (length hist) 3)
    (check-equal? (account-histogram events)
                  (list (cons "a" 2) (cons "b" 1))))

  (test-case "user stats classify plan/usage states"
    (define rows
      (list (hasheq 'contact "a@x" 'plan "pro" 'publish-count 0 'month-key ""
                    'disabled-at 0 'expires-at 0 'created-at (- NOW-MS 86400000))
            (hasheq 'contact "b@x" 'plan "pro" 'publish-count 4000 'month-key "2026-10"
                    'disabled-at 0 'expires-at (+ NOW-MS 864000000) 'created-at (- NOW-MS 2592000000))
            (hasheq 'contact "c@x" 'plan "free" 'publish-count 27 'month-key "2026-10"
                    'disabled-at 0 'expires-at 0 'created-at 0)
            (hasheq 'contact "d@x" 'plan "free" 'publish-count 5 'month-key "2026-09"
                    'disabled-at 1 'expires-at 0 'created-at 0)))
    (define s (user-stats rows NOW-MS))
    (check-equal? (hash-ref s 'total) 4)
    (check-equal? (hash-ref s 'active) 3)
    (check-equal? (hash-ref s 'disabled) 1)
    (check-equal? (hash-ref s 'proActive) 2)
    (check-equal? (hash-ref s 'newLast7d) 1)
    (check-equal? (hash-ref s 'proExpiring14d) 1))

  (test-case "near-limit flags >=80% usage in the current month only"
    (define rows
      (list (hasheq 'contact "near@x" 'plan "free" 'publish-count 27 'month-key "2026-10")
            (hasheq 'contact "low@x" 'plan "free" 'publish-count 5 'month-key "2026-10")
            (hasheq 'contact "pro-near@x" 'plan "pro" 'publish-count 4800 'month-key "2026-10")
            ;; heavy but last month's counter — must not flag
            (hasheq 'contact "stale@x" 'plan "free" 'publish-count 29 'month-key "2026-09")))
    (define near (near-limit-users rows "2026-10"))
    (check-equal? (length near) 2)
    (check-equal? (hash-ref (car near) 'contact) "pro-near@x")
    (check-equal? (hash-ref (car near) 'limit) 5000)
    (check-equal? (hash-ref (cadr near) 'contact) "near@x"))

  (test-case "revenue sums paid orders per Shanghai month"
    (define orders
      (list (hasheq 'plan "pro" 'months 1 'amount-fen 3900 'status "paid" 'paid-at 1792363200000)
            (hasheq 'plan "pro" 'months 12 'amount-fen 39000 'status "paid" 'paid-at 1785561600000)
            (hasheq 'plan "pro" 'months 1 'amount-fen 3900 'status "pending" 'paid-at 0)))
    (define by-month (revenue-by-month orders))
    (check-equal? by-month (list (cons "2026-08" 39000) (cons "2026-10" 3900))))

  ;; ---- end-to-end against a fixture data dir --------------------------------

  (define (make-fixture!)
    (define cur-mk (current-month-key))
    (define dir (make-temporary-file "publy-stats-~a" 'directory))
    (define dbc (sqlite3-connect #:database (build-path dir "users.db") #:mode 'create))
    (query-exec dbc "create table users (id text primary key, contact text not null unique, api_key text not null unique, plan text not null default 'free', expires_at integer not null default 0, publish_count integer not null default 0, month_key text not null default '', disabled_at integer not null default 0, created_at integer not null)")
    (query-exec dbc "create table accounts (name text primary key, app_id text not null, app_secret text not null, owner_user_id text)")
    (query-exec dbc "create table orders (id text primary key, contact text not null, plan text not null, months integer not null, amount_fen integer not null, provider text not null, status text not null default 'pending', user_id text, created_at integer not null, paid_at integer not null default 0)")
    (query-exec dbc "insert into users (id, contact, api_key, plan, publish_count, month_key, created_at) values ('u1', 'heavy@x', 'publy_k1', 'pro', 4500, ?, 1792276800000)" cur-mk)
    (query-exec dbc "insert into users (id, contact, api_key, plan, publish_count, month_key, created_at) values ('u2', 'light@x', 'publy_k2', 'free', 2, ?, 1792276800000)" cur-mk)
    (query-exec dbc "insert into accounts (name, app_id, app_secret, owner_user_id) values ('main', 'wx111', 'enc1:never-selected', 'u1')")
    (query-exec dbc "insert into accounts (name, app_id, app_secret, owner_user_id) values ('shared', 'wx222', 'enc1:never-selected', null)")
    (query-exec dbc "insert into orders (id, contact, plan, months, amount_fen, provider, status, created_at, paid_at) values ('o1', 'heavy@x', 'pro', 1, 3900, 'manual', 'paid', 1792000000000, 1792100000000)")
    (disconnect dbc)
    (call-with-output-file (build-path dir "history.jsonl")
      (λ (out)
        (fprintf out "~a\n" (jsexpr->string (hasheq 'ts "2026-10-14T01:00:00.000Z" 'event "published" 'account "main" 'type "news" 'title "hello" 'user "heavy@x")))
        (fprintf out "~a\n" (jsexpr->string (hasheq 'ts "2026-10-14T02:00:00.000Z" 'event "failed" 'account "main" 'type "news" 'title "oops" 'error "40001 invalid credential")))
        ;; malformed lines must be skipped, not fatal
        (display "not json\n\n" out)
        (fprintf out "~a\n" (jsexpr->string (hasheq 'ts "2026-10-14T03:00:00.000Z" 'event "deduped" 'key "k1" 'account "main" 'title "hello"))))
      #:exists 'truncate)
    dir)

  (test-case "collect-stats end-to-end on a fixture data dir"
    (define dir (make-fixture!))
    (define stats (collect-stats (stats-config dir) 7))
    (check-equal? (hash-ref (hash-ref stats 'users) 'total) 2)
    (check-equal? (hash-ref (hash-ref stats 'accounts) 'shared) 1)
    (define pub (hash-ref stats 'publishes))
    (check-equal? (hash-ref pub 'published) 1)
    (check-equal? (hash-ref pub 'failed) 1)
    (check-equal? (hash-ref (car (hash-ref stats 'topErrors)) 'error)
                  "40001 invalid credential")
    (check-equal? (hash-ref (hash-ref stats 'revenue) 'paidFen) 3900)
    (define near (hash-ref stats 'nearLimit))
    (check-equal? (and (not (null? near)) (hash-ref (car near) 'contact)) "heavy@x")
    (define report (report->string stats))
    (check-true (string-contains? report "publy stats"))
    (check-true (string-contains? report "40001 invalid credential"))
    (check-true (string-contains? report "heavy@x"))
    ;; the stats path must never surface secrets
    (check-false (string-contains? report "never-selected"))
    (check-false (string-contains? (jsexpr->string stats) "never-selected")))

  (test-case "missing data dir degrades to zeros, not an error"
    (define empty-dir (make-temporary-file "publy-stats-empty-~a" 'directory))
    (define stats (collect-stats (stats-config empty-dir) 3))
    (check-equal? (hash-ref (hash-ref stats 'users) 'total) 0)
    (check-equal? (hash-ref stats 'topErrors) '())
    (check-equal? (hash-ref (hash-ref stats 'revenue) 'paidFen) 0)))
