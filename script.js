"use strict";

/* =========================================
   AOKIRA CHESS
   Developed by Firman (Aokira)
   Offline Local Multiplayer - 1 vs 1
========================================= */

(() => {
  const $ = id => document.getElementById(id);

  const boardEl = $("board");
  const files = "abcdefgh";

  const symbols = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
  };

  const pieceNames = {
    k: "King",
    q: "Queen",
    r: "Rook",
    b: "Bishop",
    n: "Knight",
    p: "Pawn"
  };

  let game;
  let selected = null;
  let legalTargets = [];
  let history = [];
  let snapshots = [];
  let lastMove = null;
  let pendingPromotion = null;
  let gameOver = false;
  let repetition = new Map();

  const inside = (r, c) =>
    r >= 0 && r < 8 && c >= 0 && c < 8;

  const colorOf = p => p ? p[0] : null;
  const typeOf = p => p ? p[1] : null;

  const opposite = color =>
    color === "w" ? "b" : "w";

  const squareName = (r, c) =>
    files[c] + (8 - r);

  const clone = obj =>
    JSON.parse(JSON.stringify(obj));

  /* =========================================
     INITIAL BOARD
  ========================================= */

  function initialState() {
    return {
      board: [
        ["br","bn","bb","bq","bk","bb","bn","br"],
        ["bp","bp","bp","bp","bp","bp","bp","bp"],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        ["wp","wp","wp","wp","wp","wp","wp","wp"],
        ["wr","wn","wb","wq","wk","wb","wn","wr"]
      ],

      turn: "w",

      castling: {
        K: true,
        Q: true,
        k: true,
        q: true
      },

      ep: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  /* =========================================
     KING POSITION
  ========================================= */

  function findKing(state, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c] === color + "k") {
          return { r, c };
        }
      }
    }

    return null;
  }

  /* =========================================
     ATTACK DETECTION
  ========================================= */

  function isAttacked(state, r, c, byColor) {
    const board = state.board;

    // Pawn attacks
    const pawnRow = r + (byColor === "w" ? 1 : -1);

    for (const dc of [-1, 1]) {
      if (
        inside(pawnRow, c + dc) &&
        board[pawnRow][c + dc] === byColor + "p"
      ) {
        return true;
      }
    }

    // Knight attacks
    const knightMoves = [
      [-2,-1],[-2,1],
      [-1,-2],[-1,2],
      [1,-2],[1,2],
      [2,-1],[2,1]
    ];

    for (const [dr, dc] of knightMoves) {
      const rr = r + dr;
      const cc = c + dc;

      if (
        inside(rr, cc) &&
        board[rr][cc] === byColor + "n"
      ) {
        return true;
      }
    }

    // King attacks
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;

        const rr = r + dr;
        const cc = c + dc;

        if (
          inside(rr, cc) &&
          board[rr][cc] === byColor + "k"
        ) {
          return true;
        }
      }
    }

    // Rook, Bishop and Queen attacks
    const directions = [
      [-1,0,"rq"],
      [1,0,"rq"],
      [0,-1,"rq"],
      [0,1,"rq"],
      [-1,-1,"bq"],
      [-1,1,"bq"],
      [1,-1,"bq"],
      [1,1,"bq"]
    ];

    for (const [dr, dc, types] of directions) {
      let rr = r + dr;
      let cc = c + dc;

      while (inside(rr, cc)) {
        const piece = board[rr][cc];

        if (piece) {
          if (
            colorOf(piece) === byColor &&
            types.includes(typeOf(piece))
          ) {
            return true;
          }

          break;
        }

        rr += dr;
        cc += dc;
      }
    }

    return false;
  }

  function inCheck(state, color) {
    const king = findKing(state, color);

    if (!king) return false;

    return isAttacked(
      state,
      king.r,
      king.c,
      opposite(color)
    );
  }

  /* =========================================
     PSEUDO LEGAL MOVES
  ========================================= */

  function pseudoMoves(state, r, c) {
    const piece = state.board[r][c];

    if (!piece) return [];

    const color = colorOf(piece);
    const type = typeOf(piece);
    const board = state.board;
    const moves = [];

    function add(rr, cc, extra = {}) {
      if (!inside(rr, cc)) return;

      const target = board[rr][cc];

      if (target && colorOf(target) === color) return;

      // Never capture the enemy king directly
      if (target && typeOf(target) === "k") return;

      moves.push({
        from: { r, c },
        to: { r: rr, c: cc },
        ...extra
      });
    }

    // PAWN
    if (type === "p") {
      const dir = color === "w" ? -1 : 1;
      const start = color === "w" ? 6 : 1;
      const promotionRow = color === "w" ? 0 : 7;

      const oneStep = r + dir;

      if (inside(oneStep, c) && !board[oneStep][c]) {
        add(
          oneStep,
          c,
          oneStep === promotionRow
            ? { promotion: true }
            : {}
        );

        const twoStep = r + dir * 2;

        if (
          r === start &&
          !board[twoStep][c]
        ) {
          add(twoStep, c, { doublePawn: true });
        }
      }

      for (const dc of [-1, 1]) {
        const rr = r + dir;
        const cc = c + dc;

        if (!inside(rr, cc)) continue;

        const target = board[rr][cc];

        if (
          target &&
          colorOf(target) !== color &&
          typeOf(target) !== "k"
        ) {
          add(
            rr,
            cc,
            rr === promotionRow
              ? { promotion: true }
              : {}
          );
        }

        // En passant
        else if (
          state.ep &&
          state.ep.r === rr &&
          state.ep.c === cc
        ) {
          add(rr, cc, { enPassant: true });
        }
      }
    }

    // KNIGHT
    else if (type === "n") {
      const jumps = [
        [-2,-1],[-2,1],
        [-1,-2],[-1,2],
        [1,-2],[1,2],
        [2,-1],[2,1]
      ];

      for (const [dr, dc] of jumps) {
        add(r + dr, c + dc);
      }
    }

    // KING
    else if (type === "k") {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) {
            add(r + dr, c + dc);
          }
        }
      }

      // Castling
      const home = color === "w" ? 7 : 0;
      const enemy = opposite(color);

      if (r === home && c === 4 && !inCheck(state, color)) {

        // Kingside
        const kingSide = color === "w" ? "K" : "k";

        if (
          state.castling[kingSide] &&
          !board[home][5] &&
          !board[home][6] &&
          board[home][7] === color + "r" &&
          !isAttacked(state, home, 5, enemy) &&
          !isAttacked(state, home, 6, enemy)
        ) {
          add(home, 6, { castle: "K" });
        }

        // Queenside
        const queenSide = color === "w" ? "Q" : "q";

        if (
          state.castling[queenSide] &&
          !board[home][1] &&
          !board[home][2] &&
          !board[home][3] &&
          board[home][0] === color + "r" &&
          !isAttacked(state, home, 3, enemy) &&
          !isAttacked(state, home, 2, enemy)
        ) {
          add(home, 2, { castle: "Q" });
        }
      }
    }

    // ROOK, BISHOP, QUEEN
    else {
      const directions = [];

      if (type === "r" || type === "q") {
        directions.push(
          [-1,0],[1,0],[0,-1],[0,1]
        );
      }

      if (type === "b" || type === "q") {
        directions.push(
          [-1,-1],[-1,1],[1,-1],[1,1]
        );
      }

      for (const [dr, dc] of directions) {
        let rr = r + dr;
        let cc = c + dc;

        while (inside(rr, cc)) {
          const target = board[rr][cc];

          if (!target) {
            add(rr, cc);
          } else {
            if (
              colorOf(target) !== color &&
              typeOf(target) !== "k"
            ) {
              add(rr, cc);
            }

            break;
          }

          rr += dr;
          cc += dc;
        }
      }
    }

    return moves;
  }

  /* =========================================
     APPLY MOVE
  ========================================= */

  function applyMove(state, move, promotion = "q") {
    const next = clone(state);

    const from = move.from;
    const to = move.to;

    const piece = next.board[from.r][from.c];
    const color = colorOf(piece);
    const type = typeOf(piece);

    const captured = move.enPassant
      ? next.board[from.r][to.c]
      : next.board[to.r][to.c];

    next.board[from.r][from.c] = null;

    // En passant capture
    if (move.enPassant) {
      next.board[from.r][to.c] = null;
    }

    // Pawn promotion
    next.board[to.r][to.c] = move.promotion
      ? color + promotion
      : piece;

    // Castling rook movement
    if (move.castle) {
      const row = from.r;

      if (move.castle === "K") {
        next.board[row][5] = next.board[row][7];
        next.board[row][7] = null;
      } else {
        next.board[row][3] = next.board[row][0];
        next.board[row][0] = null;
      }
    }

    // King movement removes castling rights
    if (type === "k") {
      if (color === "w") {
        next.castling.K = false;
        next.castling.Q = false;
      } else {
        next.castling.k = false;
        next.castling.q = false;
      }
    }

    // Rook movement removes castling rights
    if (type === "r") {
      if (from.r === 7 && from.c === 0) next.castling.Q = false;
      if (from.r === 7 && from.c === 7) next.castling.K = false;
      if (from.r === 0 && from.c === 0) next.castling.q = false;
      if (from.r === 0 && from.c === 7) next.castling.k = false;
    }

    // Capturing a rook on its original square
    if (captured === "wr") {
      if (to.r === 7 && to.c === 0) next.castling.Q = false;
      if (to.r === 7 && to.c === 7) next.castling.K = false;
    }

    if (captured === "br") {
      if (to.r === 0 && to.c === 0) next.castling.q = false;
      if (to.r === 0 && to.c === 7) next.castling.k = false;
    }

    // En passant target
    next.ep = null;

    if (type === "p" && Math.abs(to.r - from.r) === 2) {
      next.ep = {
        r: (from.r + to.r) / 2,
        c: from.c
      };
    }

    // Halfmove clock
    next.halfmove =
      type === "p" || captured
        ? 0
        : next.halfmove + 1;

    if (color === "b") {
      next.fullmove++;
    }

    next.turn = opposite(color);

    return next;
  }

  /* =========================================
     LEGAL MOVES
  ========================================= */

  function legalMovesFor(state, r, c) {
    const piece = state.board[r][c];

    if (!piece || colorOf(piece) !== state.turn) {
      return [];
    }

    return pseudoMoves(state, r, c).filter(move => {
      const next = applyMove(state, move);

      return !inCheck(next, colorOf(piece));
    });
  }

  function allLegalMoves(state, color = state.turn) {
    const moves = [];

    const tempState = {
      ...state,
      turn: color
    };

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (colorOf(state.board[r][c]) === color) {
          moves.push(
            ...legalMovesFor(tempState, r, c)
          );
        }
      }
    }

    return moves;
  }

  /* =========================================
     DRAW DETECTION
  ========================================= */

  function positionKey(state) {
    const boardKey = state.board
      .map(row => row.map(p => p || "--").join(""))
      .join("/");

    const rights = Object.keys(state.castling)
      .filter(k => state.castling[k])
      .join("");

    const ep = state.ep
      ? squareName(state.ep.r, state.ep.c)
      : "-";

    return boardKey + " " + state.turn + " " + rights + " " + ep;
  }

  function insufficientMaterial(state) {
    const pieces = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];

        if (!p || typeOf(p) === "k") continue;

        const type = typeOf(p);

        if (["p", "q", "r"].includes(type)) {
          return false;
        }

        pieces.push({
          type,
          color: colorOf(p),
          square: (r + c) % 2
        });
      }
    }

    if (pieces.length <= 1) return true;

    return (
      pieces.every(p => p.type === "b") &&
      pieces.every(p => p.square === pieces[0].square)
    );
  }

  function gameStatus() {
    const moves = allLegalMoves(game);
    const check = inCheck(game, game.turn);

    if (moves.length === 0) {
      if (check) {
        return {
          over: true,
          result: game.turn === "w" ? "0-1" : "1-0",
          text: "Skakmat! " +
            (game.turn === "w" ? "Hitam" : "Putih") +
            " menang."
        };
      }

      return {
        over: true,
        result: "½-½",
        text: "Stalemate! Pertandingan remis."
      };
    }

    if (game.halfmove >= 150) {
      return {
        over: true,
        result: "½-½",
        text: "Remis otomatis berdasarkan aturan 75 langkah."
      };
    }

    if ((repetition.get(positionKey(game)) || 0) >= 5) {
      return {
        over: true,
        result: "½-½",
        text: "Remis otomatis karena posisi berulang lima kali."
      };
    }

    if ((repetition.get(positionKey(game)) || 0) >= 3) {
      return {
        over: true,
        result: "½-½",
        text: "Posisi berulang tiga kali. Remis."
      };
    }

    if (insufficientMaterial(game)) {
      return {
        over: true,
        result: "½-½",
        text: "Materi tidak cukup untuk skakmat. Remis."
      };
    }

    return {
      over: false,
      check
    };
  }

  /* =========================================
     CHESS NOTATION - SAN
  ========================================= */

  function sanFor(before, move, promotion = "q") {
    const piece = before.board[move.from.r][move.from.c];
    const type = typeOf(piece);
    const color = colorOf(piece);

    if (move.castle) {
      return move.castle === "K" ? "O-O" : "O-O-O";
    }

    let san = "";

    if (type !== "p") {
      san = type.toUpperCase();

      const alternatives = allLegalMoves(before, color).filter(m => {
        return (
          m.to.r === move.to.r &&
          m.to.c === move.to.c &&
          (
            m.from.r !== move.from.r ||
            m.from.c !== move.from.c
          ) &&
          typeOf(before.board[m.from.r][m.from.c]) === type
        );
      });

      if (alternatives.length) {
        const sameFile = alternatives.some(
          m => m.from.c === move.from.c
        );

        const sameRank = alternatives.some(
          m => m.from.r === move.from.r
        );

        if (!sameFile) {
          san += files[move.from.c];
        } else if (!sameRank) {
          san += String(8 - move.from.r);
        } else {
          san += squareName(move.from.r, move.from.c);
        }
      }
    } else if (
      before.board[move.to.r][move.to.c] ||
      move.enPassant
    ) {
      san += files[move.from.c];
    }

    if (
      before.board[move.to.r][move.to.c] ||
      move.enPassant
    ) {
      san += "x";
    }

    san += squareName(move.to.r, move.to.c);

    if (move.promotion) {
      san += "=" + promotion.toUpperCase();
    }

    const after = applyMove(before, move, promotion);

    if (inCheck(after, after.turn)) {
      san += allLegalMoves(after).length ? "+" : "#";
    }

    return san;
  }

  /* =========================================
     GAME INITIALIZATION
  ========================================= */

  function resetGame() {
    game = initialState();

    selected = null;
    legalTargets = [];
    history = [];
    snapshots = [];
    lastMove = null;
    pendingPromotion = null;
    gameOver = false;

    repetition = new Map([
      [positionKey(game), 1]
    ]);

    render();
  }

  /* =========================================
     PLAYER INTERACTION
  ========================================= */

  function choosePiece(r, c) {
    selected = { r, c };
    legalTargets = legalMovesFor(game, r, c);

    render();
  }

  function selectSquare(r, c) {
    if (gameOver || pendingPromotion) return;

    const piece = game.board[r][c];

    if (selected) {
      const target = legalTargets.find(move =>
        move.to.r === r && move.to.c === c
      );

      if (target) {
        performMove(target);
        return;
      }

      // Switch selection to another own piece
      if (piece && colorOf(piece) === game.turn) {
        choosePiece(r, c);
        return;
      }

      // Cancel selection
      selected = null;
      legalTargets = [];

      render();
      return;
    }

    if (piece && colorOf(piece) === game.turn) {
      choosePiece(r, c);
    }
  }

  /* =========================================
     EXECUTE MOVE
  ========================================= */

  function performMove(move, promotion = null) {
    if (gameOver) return;

    if (move.promotion && !promotion) {
      pendingPromotion = move;

      $("promotion-dialog").showModal();
      return;
    }

    const before = clone(game);
    const movingPiece = game.board[move.from.r][move.from.c];

    const notation = sanFor(before, move, promotion || "q");

    // Save undo state
    snapshots.push({
      game: clone(game),
      history: clone(history),
      lastMove: clone(lastMove),
      repetition: [...repetition.entries()]
    });

    game = applyMove(game, move, promotion || "q");

    history.push({
      color: colorOf(movingPiece),
      san: notation,
      number: before.fullmove
    });

    lastMove = {
      from: move.from,
      to: move.to
    };

    selected = null;
    legalTargets = [];
    pendingPromotion = null;

    const key = positionKey(game);

    repetition.set(
      key,
      (repetition.get(key) || 0) + 1
    );

    render();

    const status = gameStatus();

    if (status.over) {
      gameOver = true;
      render();

      showMessage(
        "Pertandingan selesai",
        status.text + " Hasil: " + status.result
      );
    }
  }

  /* =========================================
     BOARD RENDERING
  ========================================= */

  function render() {
    boardEl.innerHTML = "";

    const currentCheck = inCheck(game, game.turn)
      ? findKing(game, game.turn)
      : null;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const square = document.createElement("button");

        square.type = "button";

        square.className =
          "square " +
          ((r + c) % 2 === 0 ? "light" : "dark");

        square.setAttribute("role", "gridcell");

        square.setAttribute(
          "aria-label",
          squareName(r, c) +
          (game.board[r][c]
            ? " " + pieceNames[typeOf(game.board[r][c])]
            : ", kosong")
        );

        // Selected square
        if (
          selected &&
          selected.r === r &&
          selected.c === c
        ) {
          square.classList.add("selected");
        }

        // Last move
        if (
          lastMove &&
          (
            (lastMove.from.r === r && lastMove.from.c === c) ||
            (lastMove.to.r === r && lastMove.to.c === c)
          )
        ) {
          square.classList.add("last-move");
        }

        // Legal targets
        const target = legalTargets.find(m =>
          m.to.r === r && m.to.c === c
        );

        if (target) {
          square.classList.add("legal");

          if (
            game.board[r][c] ||
            target.enPassant
          ) {
            square.classList.add("capture");
          }
        }

        // King in check
        if (
          currentCheck &&
          currentCheck.r === r &&
          currentCheck.c === c
        ) {
          square.classList.add("in-check");
        }

        // Coordinates
        if (c === 0) {
          const rank = document.createElement("span");

          rank.className = "coord rank-coord";
          rank.textContent = 8 - r;

          square.appendChild(rank);
        }

        if (r === 7) {
          const file = document.createElement("span");

          file.className = "coord file-coord";
          file.textContent = files[c].toUpperCase();

          square.appendChild(file);
        }

        // Chess piece
        const piece = game.board[r][c];

        if (piece) {
          const span = document.createElement("span");

          span.className =
            "piece " +
            (colorOf(piece) === "w" ? "white" : "black");

          span.textContent =
            symbols[colorOf(piece)][typeOf(piece)];

          square.appendChild(span);
        }

        // Each square receives exactly one listener
        square.addEventListener("click", () => {
          selectSquare(r, c);
        });

        boardEl.appendChild(square);
      }
    }

    updateInterface();
  }

  /* =========================================
     USER INTERFACE
  ========================================= */

  function updateInterface() {
    const status = gameStatus();

    $("turn-title").textContent =
      gameOver
        ? "Pertandingan selesai"
        : game.turn === "w"
          ? "Putih bergerak"
          : "Hitam bergerak";

    $("status-text").textContent =
      gameOver
        ? "Permainan telah berakhir."
        : status.check
          ? "SKAK! Raja sedang terancam."
          : selected
            ? "Pilih kotak tujuan yang ditandai."
            : "Pilih salah satu bidak " +
              (game.turn === "w" ? "putih." : "hitam.");

    $("check-status").textContent =
      status.check ? "SKAK" : "Aman";

    $("check-status").classList.toggle(
      "warning",
      !!status.check
    );

    $("move-count").textContent =
      String(history.length ? Math.ceil(history.length / 2) : 0);

    $("white-card").classList.toggle(
      "active",
      !gameOver && game.turn === "w"
    );

    $("black-card").classList.toggle(
      "active",
      !gameOver && game.turn === "b"
    );

    $("white-turn").style.opacity =
      !gameOver && game.turn === "w" ? "1" : ".2";

    $("black-turn").style.opacity =
      !gameOver && game.turn === "b" ? "1" : ".2";

    $("undo").disabled =
      !snapshots.length || gameOver;

    $("resign").disabled = gameOver;

    renderHistory();
  }

  /* =========================================
     MOVE HISTORY
  ========================================= */

  function renderHistory() {
    const el = $("move-history");

    $("history-count").textContent =
      history.length + " PLY";

    if (!history.length) {
      el.innerHTML =
        '<div class="empty-history">' +
        'Belum ada langkah.<br>' +
        'Mulai pertandingan pertamamu.' +
        '</div>';

      return;
    }

    const rows = [];

    for (let i = 0; i < history.length; i += 2) {
      const white = history[i];
      const black = history[i + 1];

      rows.push(
        '<div class="history-line">' +
          '<span class="move-number">' + (Math.floor(i / 2) + 1) + '.</span>' +
          '<span class="move-white">' + (white ? white.san : "") + '</span>' +
          '<span class="move-black">' + (black ? black.san : "") + '</span>' +
        '</div>'
      );
    }

    el.innerHTML = rows.join("");
    el.scrollTop = el.scrollHeight;
  }

  /* =========================================
     UNDO
  ========================================= */

  function undo() {
    if (!snapshots.length || gameOver) return;

    const snapshot = snapshots.pop();

    game = snapshot.game;
    history = snapshot.history;
    lastMove = snapshot.lastMove;

    repetition = new Map(snapshot.repetition);

    selected = null;
    legalTargets = [];
    pendingPromotion = null;

    render();
  }

  /* =========================================
     DIALOGS
  ========================================= */

  function showMessage(title, body) {
    $("message-title").textContent = title;
    $("message-body").textContent = body;

    $("message-dialog").showModal();
  }

  function resign() {
    if (gameOver) return;

    const winner =
      opposite(game.turn) === "w" ? "Putih" : "Hitam";

    gameOver = true;

    render();

    showMessage(
      "Pemain menyerah",
      (game.turn === "w" ? "Putih" : "Hitam") +
      " menyerah. " + winner + " menang."
    );
  }

  /* =========================================
     BUTTON EVENTS
  ========================================= */

  $("new-game").addEventListener("click", () => {
    if (
      history.length &&
      !gameOver &&
      !confirm("Mulai permainan baru? Posisi saat ini akan dihapus.")
    ) {
      return;
    }

    resetGame();
  });

  $("undo").addEventListener("click", undo);

  $("resign").addEventListener("click", () => {
    if (confirm("Yakin ingin menyerah?")) {
      resign();
    }
  });

  $("message-new").addEventListener("click", () => {
    $("message-dialog").close();
    resetGame();
  });

  $("message-close").addEventListener("click", () => {
    $("message-dialog").close();
  });

  /* =========================================
     PAWN PROMOTION
  ========================================= */

  $("promotion-dialog")
    .querySelectorAll("[data-piece]")
    .forEach(button => {

      button.addEventListener("click", () => {
        if (!pendingPromotion) return;

        const move = pendingPromotion;
        const selectedPiece = button.dataset.piece;

        $("promotion-dialog").close();

        performMove(move, selectedPiece);
      });
    });

  // Prevent closing promotion without choosing
  $("promotion-dialog").addEventListener("cancel", event => {
    event.preventDefault();
  });

  /* =========================================
     START GAME
  ========================================= */

  resetGame();

  console.log(
    "AOKIRA CHESS initialized successfully. Developed by Firman (Aokira)."
  );

})();
