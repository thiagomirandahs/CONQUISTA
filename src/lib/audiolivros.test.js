import { describe, it, expect, beforeEach } from 'vitest'
import { livroDoRequisito, idDoVideo, urlDoPlayer, lerProgresso, salvarProgresso, concluirCapitulo } from './audiolivros.js'

const LIVROS = [{ id: 'a', titulo: 'Vaso de Barro' }, { id: 'b', titulo: 'Além da Magia' }, { id: 'c', titulo: 'O Fim do Começo' }]

describe('audiolivros: livro do requisito', () => {
  it('acha pelo título entre aspas, sem ligar para acento e maiúscula', () => {
    expect(livroDoRequisito('Ler o livro da classe: "Vaso de Barro".', LIVROS)?.id).toBe('a')
    expect(livroDoRequisito('Ler o livro da classe: "Além da magia".', LIVROS)?.id).toBe('b')
    expect(livroDoRequisito('Ler o livro da classe: “O Fim do Comeco”.', LIVROS)?.id).toBe('c')
  })
  it('acha os livros das avançadas pelo texto real do manifesto', () => {
    const ls = [{ id: 'd', titulo: 'O Desejado de Todas as Nações' }, { id: 'm', titulo: 'O Maior Discurso de Cristo' }]
    expect(livroDoRequisito('Ler o capítulo 7 de "O Desejado de Todas as Nações" e apresentar as lições.', ls)?.id).toBe('d')
    expect(livroDoRequisito('Ler o livro "O Maior Discurso de Cristo" e escrever uma página.', ls)?.id).toBe('m')
  })
  it('não acha quando o livro não está no catálogo (OMD trocou) nem sem aspas', () => {
    expect(livroDoRequisito('Ler o livro da classe: "Livro Novo".', LIVROS)).toBeNull()
    expect(livroDoRequisito('Ler o livro do Curso de Leitura do ano.', LIVROS)).toBeNull()
    expect(livroDoRequisito('Vaso de Barro sem aspas', LIVROS)).toBeNull()
    expect(livroDoRequisito('"Vaso de Barro"', [])).toBeNull()
  })
})

describe('audiolivros: link do YouTube', () => {
  it('entende os formatos comuns', () => {
    expect(idDoVideo('0lMzikRDG7w')).toBe('0lMzikRDG7w')
    expect(idDoVideo('https://www.youtube.com/watch?v=0lMzikRDG7w&list=PLx')).toBe('0lMzikRDG7w')
    expect(idDoVideo('https://youtu.be/-j8DeD7twF0?si=abc')).toBe('-j8DeD7twF0')
    expect(idDoVideo('https://youtube.com/shorts/cashnjT-gjI')).toBe('cashnjT-gjI')
  })
  it('recusa o que não é vídeo', () => {
    expect(idDoVideo('https://exemplo.com')).toBeNull()
    expect(idDoVideo('https://www.youtube.com/playlist?list=PLZzUHCA4d0QyFhugtYE0G5OosiXxIONu7')).toBeNull()
    expect(idDoVideo('')).toBeNull()
  })
  it('o player é o sem cookie', () => {
    expect(urlDoPlayer('0lMzikRDG7w')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/0lMzikRDG7w\?/)
  })
})

describe('audiolivros: progresso', () => {
  beforeEach(() => localStorage.clear())
  it('começa no capítulo 1 e lembra onde parou', () => {
    expect(lerProgresso('u', 'a')).toEqual({ atual: 1, ouvidos: [] })
    salvarProgresso('u', 'a', { atual: 3, ouvidos: [1, 2] })
    expect(lerProgresso('u', 'a')).toEqual({ atual: 3, ouvidos: [1, 2] })
    expect(lerProgresso('outra', 'a')).toEqual({ atual: 1, ouvidos: [] })
  })
  it('concluir marca como ouvido e avança, sem passar do último', () => {
    expect(concluirCapitulo({ atual: 1, ouvidos: [] }, 3)).toEqual({ atual: 2, ouvidos: [1] })
    expect(concluirCapitulo({ atual: 3, ouvidos: [1, 2] }, 3)).toEqual({ atual: 3, ouvidos: [1, 2, 3] })
  })
})
