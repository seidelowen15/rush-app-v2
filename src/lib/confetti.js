export function fireConfetti(x, y) {
  const colors = ['#F5B50A', '#12317E', '#ffffff', '#FFCB3D', '#1D3C8F']
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div')
    el.className = 'confetti-piece'
    const size = Math.random() * 8 + 6
    el.style.cssText = `
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration: ${Math.random() * 1.5 + 1}s;
      animation-delay: ${Math.random() * 0.3}s;
      transform-origin: center;
      margin-left: ${(Math.random() - 0.5) * 200}px;
    `
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2500)
  }
}
