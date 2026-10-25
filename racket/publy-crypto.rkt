#lang racket/base

;; Self-contained SHA-256 and HMAC-SHA256 (FIPS 180-4, RFC 2104/4231).
;;
;; The events gateway verifies short-lived WS tickets issued by the fastify
;; server (see publy-ws.rkt); this module keeps that dependency-free instead
;; of pulling a crypto package into every deployment. Messages are ticket MAC
;; inputs (< 200 bytes), so exact-integer arithmetic is plenty.

(require racket/contract)

(provide
  ;; hex digests, lowercase
  (contract-out
    [sha256 (-> bytes? string?)]
    [hmac-sha256 (-> bytes? bytes? string?)]))

(define M 4294967295) ; 2^32 - 1, mask for all arithmetic

(define (rotr x n)
  (bitwise-and (bitwise-ior (arithmetic-shift x (- n))
                            (arithmetic-shift x (- 32 n)))
               M))

(define K
  (vector 1116352408 1899447441 3049323471 3921009573 961987163 1508970993 2453635748 2870763221
          3624381080 310598401 607225278 1426881987 1925078388 2162078206 2614888103 3248222580
          3835390401 4022224774 264347078 604807628 770255983 1249150122 1555081692 1996064986
          2554220882 2821834349 2952996808 3210313671 3336571891 3584528711 113926993 338241895
          666307205 773529912 1294757372 1396182291 1695183700 1986661051 2177026350 2456956037
          2730485921 2820302411 3259730800 3345764771 3516065817 3600352804 4094571909 275423344
          430227734 506948616 659060556 883997877 958139571 1322822218 1537002063 1747873779
          1955562222 2024104815 2227730452 2361852424 2428436474 2756734187 3204031479 3329325298))

(define (u32-hex v)
  (list->string
   (for/list ([j (in-range 8)])
     (string-ref "0123456789abcdef"
                 (bitwise-and (arithmetic-shift v (* -4 (- 7 j))) 15)))))

(define (hex->bytes s)
  (define n (string-length s))
  (define out (make-bytes (quotient n 2)))
  (for ([i (in-range (quotient n 2))])
    (define hi (string-ref s (* 2 i)))
    (define lo (string-ref s (+ (* 2 i) 1)))
    (bytes-set! out i
                (+ (* 16
                      (cond
                        [(char<=? #\0 hi #\9) (- (char->integer hi) 48)]
                        [(char<=? #\a hi #\f) (+ 10 (- (char->integer hi) 97))]
                        [else (+ 10 (- (char->integer hi) 65))]))
                   (cond
                     [(char<=? #\0 lo #\9) (- (char->integer lo) 48)]
                     [(char<=? #\a lo #\f) (+ 10 (- (char->integer lo) 97))]
                     [else (+ 10 (- (char->integer lo) 65))]))))
  out)

;; → lowercase hex digest
(define (sha256 bs)
  (define len (bytes-length bs))
  (define total (* (ceiling (/ (+ len 9) 64)) 64))
  (define buf (make-bytes total 0))
  (bytes-copy! buf 0 bs)
  (bytes-set! buf len #x80)
  (for ([i (in-range 8)])
    (bytes-set! buf (+ i (- total 8))
                (bitwise-and (arithmetic-shift (* len 8) (* -8 (- 7 i))) #xff)))
  (define h (vector 1779033703 3144134277 1013904242 2773480762
                    1359893119 2600822924 528734635 1541459225))
  (define w (make-vector 64 0))
  (for ([chunk (in-range 0 total 64)])
    (for ([t (in-range 16)])
      (vector-set! w t
                   (+ (* (bytes-ref buf (+ chunk (* 4 t))) 16777216)
                      (* (bytes-ref buf (+ chunk (* 4 t) 1)) 65536)
                      (* (bytes-ref buf (+ chunk (* 4 t) 2)) 256)
                      (bytes-ref buf (+ chunk (* 4 t) 3)))))
    (for ([t (in-range 16 64)])
      (define x15 (vector-ref w (- t 15)))
      (define x2 (vector-ref w (- t 2)))
      (define s0 (bitwise-xor (rotr x15 7) (rotr x15 18) (arithmetic-shift x15 -3)))
      (define s1 (bitwise-xor (rotr x2 17) (rotr x2 19) (arithmetic-shift x2 -10)))
      (vector-set! w t (bitwise-and (+ (vector-ref w (- t 16)) s0 (vector-ref w (- t 7)) s1) M)))
    (define-values (a b c d e f g hh)
      (for/fold ([a (vector-ref h 0)] [b (vector-ref h 1)] [c (vector-ref h 2)] [d (vector-ref h 3)]
                 [e (vector-ref h 4)] [f (vector-ref h 5)] [g (vector-ref h 6)] [hh (vector-ref h 7)])
                ([t (in-range 64)])
        (define S1 (bitwise-xor (rotr e 6) (rotr e 11) (rotr e 25)))
        (define ch (bitwise-xor (bitwise-and e f) (bitwise-and (bitwise-not e) g)))
        (define t1 (bitwise-and (+ hh S1 ch (vector-ref K t) (vector-ref w t)) M))
        (define S0 (bitwise-xor (rotr a 2) (rotr a 13) (rotr a 22)))
        (define mj (bitwise-xor (bitwise-and a b) (bitwise-and a c) (bitwise-and b c)))
        (define t2 (bitwise-and (+ S0 mj) M))
        (values (bitwise-and (+ t1 t2) M) a b c (bitwise-and (+ d t1) M) e f g)))
    (vector-set! h 0 (bitwise-and (+ a (vector-ref h 0)) M))
    (vector-set! h 1 (bitwise-and (+ b (vector-ref h 1)) M))
    (vector-set! h 2 (bitwise-and (+ c (vector-ref h 2)) M))
    (vector-set! h 3 (bitwise-and (+ d (vector-ref h 3)) M))
    (vector-set! h 4 (bitwise-and (+ e (vector-ref h 4)) M))
    (vector-set! h 5 (bitwise-and (+ f (vector-ref h 5)) M))
    (vector-set! h 6 (bitwise-and (+ g (vector-ref h 6)) M))
    (vector-set! h 7 (bitwise-and (+ hh (vector-ref h 7)) M)))
  (apply string-append (for/list ([i (in-range 8)]) (u32-hex (vector-ref h i)))))

;; RFC 2104 HMAC over SHA-256; key longer than one block is hashed first
(define (hmac-sha256 key message)
  (define block 64)
  (define base (if (> (bytes-length key) block) (hex->bytes (sha256 key)) key))
  (define k (bytes-append base (make-bytes (- block (bytes-length base)) 0)))
  (define ipad (make-bytes block))
  (define opad (make-bytes block))
  (for ([i (in-range block)])
    (bytes-set! ipad i (bitwise-xor (bytes-ref k i) #x36))
    (bytes-set! opad i (bitwise-xor (bytes-ref k i) #x5c)))
  (sha256 (bytes-append opad (hex->bytes (sha256 (bytes-append ipad message))))))

(module+ test
  (require rackunit)
  ;; FIPS 180-4 examples
  (check-equal? (sha256 #"abc")
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  (check-equal? (sha256 #"")
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  (check-equal? (sha256 (make-bytes 120 (char->integer #\x)))
                "13f05a0b594787f5ecd315edc96141bd3243203d1b7d4f0836f37308b276ba98")
  ;; RFC 4231 test cases 1, 2 + edge cases cross-checked against Node crypto
  (check-equal? (hmac-sha256 (make-bytes 20 #x0b) #"Hi There")
                "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
  (check-equal? (hmac-sha256 #"Jefe" #"what do ya want for nothing?")
                "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
  (check-equal? (hmac-sha256 #"" #"")
                "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad")
  (check-equal? (hmac-sha256 (make-bytes 131 (char->integer #\a)) #"long key")
                "6e0f816ea055444e52a38308d16f3773ce902c7cf235810ca9e40bdbc66daecc")
  (check-equal? (hmac-sha256 #"secret-key-strings-work-too" #"ws-ticket:abc:def")
                "2d75e20b3718569fe15c685dbd4f400c6dc183378b2e2df26f7f0b86f825c256"))
