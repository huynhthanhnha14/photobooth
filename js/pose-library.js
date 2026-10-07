// ============================================
// POSE LIBRARY - Thư viện silhouette + AI text-to-pose
// ============================================
window.PoseLibrary = (() => {

  const POSES = {
    'peace': {
      name: 'Giơ tay chữ V',
      people: 1,
      hint: 'Giơ tay phải lên tạo chữ V',
      paths: [
        'M 200 80 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0 Z',
        'M 175 115 L 225 115 L 230 240 L 220 380 L 180 380 L 170 240 Z',
        'M 175 130 L 145 220 L 130 320 L 115 320 L 130 220 L 160 125 Z',
        'M 225 130 L 260 90 L 270 60 L 285 65 L 275 100 L 245 145 Z',
      ],
    },
    'heart-hands': {
      name: 'Tay tạo trái tim',
      people: 1,
      hint: 'Đặt 2 tay tạo hình trái tim trên đầu',
      paths: [
        'M 200 80 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0 Z',
        'M 175 115 L 225 115 L 230 240 L 220 380 L 180 380 L 170 240 Z',
        'M 175 130 L 155 90 L 175 55 L 195 65 L 180 95 L 190 125 Z',
        'M 225 130 L 245 90 L 225 55 L 205 65 L 220 95 L 210 125 Z',
      ],
    },
    'star-pose': {
      name: 'Hình ngôi sao',
      people: 1,
      hint: '2 tay 2 chân xoè rộng',
      paths: [
        'M 200 100 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0 Z',
        'M 175 130 L 100 130 L 60 110 L 55 125 L 100 150 L 170 150 Z',
        'M 225 130 L 300 130 L 340 110 L 345 125 L 300 150 L 230 150 Z',
        'M 180 145 L 220 145 L 230 280 L 220 400 L 180 400 L 170 280 Z',
        'M 175 400 L 140 520 L 120 560 L 140 560 L 175 500 L 195 410 Z',
        'M 225 400 L 260 520 L 280 560 L 260 560 L 225 500 L 205 410 Z',
      ],
    },
    'wave': {
      name: 'Vẫy tay',
      people: 1,
      hint: 'Vẫy tay chào',
      paths: [
        'M 200 80 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0 Z',
        'M 175 115 L 225 115 L 230 240 L 220 380 L 180 380 L 170 240 Z',
        'M 175 130 L 145 220 L 130 320 L 115 320 L 130 220 L 160 125 Z',
        'M 225 130 L 270 80 L 285 50 L 295 55 L 285 90 L 245 145 Z',
      ],
    },
    'cool': {
      name: 'Tạo dáng ngầu',
      people: 1,
      hint: 'Khoanh tay, mặt lạnh',
      paths: [
        'M 200 80 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0 Z',
        'M 175 115 L 225 115 L 230 240 L 220 380 L 180 380 L 170 240 Z',
        'M 170 170 L 250 180 L 250 195 L 165 185 Z',
        'M 230 200 L 155 210 L 155 195 L 235 185 Z',
      ],
    },
    'jump': {
      name: 'Nhảy lên',
      people: 1,
      hint: 'Nhảy lên, 2 tay giơ cao',
      paths: [
        'M 200 80 m -28 0 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z',
        'M 180 115 L 220 115 L 225 220 L 215 320 L 185 320 L 175 220 Z',
        'M 180 130 L 145 80 L 130 40 L 145 35 L 165 80 L 195 135 Z',
        'M 220 130 L 255 80 L 270 40 L 255 35 L 235 80 L 205 135 Z',
        'M 185 320 L 160 400 L 130 430 L 145 445 L 175 410 L 200 340 Z',
        'M 215 320 L 240 400 L 270 430 L 255 445 L 225 410 L 200 340 Z',
      ],
    },
    'bow': {
      name: 'Cúi chào',
      people: 1,
      hint: 'Cúi người chào',
      paths: [
        'M 180 130 m -28 0 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z',
        'M 160 170 L 200 175 L 215 280 L 205 400 L 175 400 L 155 280 Z',
        'M 155 200 L 200 230 L 210 245 L 195 245 L 155 220 Z',
        'M 205 200 L 160 230 L 150 245 L 165 245 L 205 220 Z',
      ],
    },
    'couple-heart': {
      name: '2 người tạo tim',
      people: 2,
      hint: '2 người đứng cạnh, mỗi người 1 tay tạo tim',
      paths: [
        'M 130 100 m -25 0 a 25 25 0 1 0 50 0 a 25 25 0 1 0 -50 0 Z',
        'M 110 130 L 150 130 L 155 240 L 145 380 L 115 380 L 105 240 Z',
        'M 150 150 L 200 130 L 220 100 L 235 110 L 210 145 L 160 170 Z',
        'M 110 150 L 85 220 L 75 300 L 60 300 L 75 220 L 100 145 Z',
        'M 270 100 m -25 0 a 25 25 0 1 0 50 0 a 25 25 0 1 0 -50 0 Z',
        'M 250 130 L 290 130 L 295 240 L 285 380 L 255 380 L 245 240 Z',
        'M 250 150 L 200 130 L 180 100 L 165 110 L 190 145 L 240 170 Z',
        'M 290 150 L 315 220 L 325 300 L 340 300 L 325 220 L 300 145 Z',
      ],
    },
    'besties': {
      name: 'Bạn thân',
      people: 2,
      hint: '2 người đứng sát, tay khoác vai',
      paths: [
        'M 140 100 m -28 0 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z',
        'M 118 130 L 162 130 L 168 240 L 158 380 L 122 380 L 112 240 Z',
        'M 162 150 L 220 140 L 240 145 L 220 160 L 165 165 Z',
        'M 118 150 L 90 220 L 80 300 L 65 300 L 80 220 L 108 145 Z',
        'M 260 100 m -28 0 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z',
        'M 238 130 L 282 130 L 288 240 L 278 380 L 242 380 L 232 240 Z',
        'M 238 150 L 180 140 L 160 145 L 180 160 L 235 165 Z',
        'M 282 150 L 310 220 L 320 300 L 335 300 L 320 220 L 292 145 Z',
      ],
    },
    'group-3': {
      name: 'Nhóm 3 người',
      people: 3,
      hint: '3 người đứng cạnh nhau',
      paths: [
        'M 80 110 m -25 0 a 25 25 0 1 0 50 0 a 25 25 0 1 0 -50 0 Z',
        'M 60 140 L 100 140 L 105 250 L 95 380 L 65 380 L 55 250 Z',
        'M 200 90 m -28 0 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 Z',
        'M 178 125 L 222 125 L 228 240 L 218 380 L 182 380 L 172 240 Z',
        'M 320 110 m -25 0 a 25 25 0 1 0 50 0 a 25 25 0 1 0 -50 0 Z',
        'M 300 140 L 340 140 L 345 250 L 335 380 L 305 380 L 295 250 Z',
      ],
    },
  };

  const KEYWORDS = {
    'tim': 'heart-hands',
    'trái tim': 'heart-hands',
    'heart': 'heart-hands',
    'yêu': 'heart-hands',
    'love': 'heart-hands',
    'v': 'peace',
    'peace': 'peace',
    'hoà bình': 'peace',
    'ngôi sao': 'star-pose',
    'star': 'star-pose',
    'sao': 'star-pose',
    'vẫy': 'wave',
    'wave': 'wave',
    'chào': 'wave',
    'hello': 'wave',
    'hi': 'wave',
    'ngầu': 'cool',
    'cool': 'cool',
    'khoanh tay': 'cool',
    'cặp đôi': 'couple-heart',
    'đôi': 'couple-heart',
    'couple': 'couple-heart',
    'bạn': 'besties',
    'bạn thân': 'besties',
    'besties': 'besties',
    'nhóm': 'group-3',
    'group': 'group-3',
    'team': 'group-3',
    'nhảy': 'jump',
    'jump': 'jump',
    'cúi': 'bow',
    'bow': 'bow',
  };

  function aiSuggestPose(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();
    for (const [kw, poseId] of Object.entries(KEYWORDS)) {
      if (lower.includes(kw)) return poseId;
    }
    return null;
  }

  function renderPose(canvas, poseId, options = {}) {
    const pose = POSES[poseId];
    if (!pose || !canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const scaleX = w / 400;
    const scaleY = h / 600;
    ctx.save();
    ctx.scale(scaleX, scaleY);

    ctx.fillStyle = options.fillColor || 'rgba(10, 22, 40, 0.55)';
    ctx.strokeStyle = options.strokeColor || 'rgba(251, 191, 36, 0.9)';
    ctx.lineWidth = 4 / Math.min(scaleX, scaleY);

    pose.paths.forEach((pathStr) => {
      const path = new Path2D(pathStr);
      ctx.fill(path);
      if (options.stroke !== false) ctx.stroke(path);
    });

    ctx.restore();
  }

  function renderThumbnail(canvas, poseId, size = 100) {
    canvas.width = size;
    canvas.height = size * 1.5;
    renderPose(canvas, poseId, {
      fillColor: 'rgba(56, 189, 248, 0.4)',
      strokeColor: 'rgba(251, 191, 36, 0.8)',
    });
  }

  function getAllPoses() {
    return Object.entries(POSES).map(([id, pose]) => ({
      id,
      name: pose.name,
      people: pose.people,
      hint: pose.hint,
    }));
  }

  function getPose(id) {
    return POSES[id] ? { id, ...POSES[id] } : null;
  }

  return {
    POSES,
    KEYWORDS,
    aiSuggestPose,
    renderPose,
    renderThumbnail,
    getAllPoses,
    getPose,
  };
})();