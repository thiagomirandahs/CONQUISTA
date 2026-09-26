// Recursos de animação do framer-motion, carregados DEPOIS do primeiro paint (LazyMotion em main.jsx).
// `domMax` (e não `domAnimation`) porque o rodapé usa `layoutId` — sem ele a bolinha do item ativo
// deixaria de deslizar entre as abas.
export { domMax as default } from 'framer-motion'
