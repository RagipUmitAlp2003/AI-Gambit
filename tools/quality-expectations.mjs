export const syntheticExpectation = {
  minCriteria: 15,
  declaredTotalScore: 100,
  scoreGroups: [
    { name: "ÖTR toplamı", maxScore: 100, keywords: ["ön tasarım"] },
  ],
  requiredFindings: [
    { name: "Problem tanımı", keywords: ["problem", "gereksinim"], effect: "score", maxScore: 10 },
    { name: "Özgünlük", keywords: ["özgünlük", "yenilik"], effect: "score", maxScore: 20 },
    { name: "Teknik tasarım", keywords: ["teknik", "tasarım"], effect: "score", maxScore: 25 },
    { name: "Doğrulama planı", keywords: ["yöntem", "doğrulama", "15 puan"], effect: "score", maxScore: 15 },
    { name: "Uygulanabilirlik", keywords: ["uygulanabilirlik", "proje"], effect: "score", maxScore: 15 },
    { name: "Yaygın etki", keywords: ["yaygın", "sürdürülebilirlik"], effect: "score", maxScore: 10 },
    { name: "Raporlama", keywords: ["raporlama", "kaynak"], effect: "score", maxScore: 5 },
  ],
  forbiddenCriteria: [
    { name: "Varsayılan Times New Roman kuralı", keywords: ["times new roman"] },
  ],
};

export const idaExpectation = {
  minCriteria: 35,
  declaredTotalScore: 315,
  scoreGroups: [
    { name: "Rapor", maxScore: 15, keywords: ["rapor"] },
    { name: "Parkur 1", maxScore: 55, keywords: ["parkur", "1"] },
    { name: "Parkur 2", maxScore: 100, keywords: ["parkur", "2"] },
    { name: "Parkur 3", maxScore: 145, keywords: ["parkur", "3"] },
  ],
  requiredFindings: [
    { name: "Görev/komut ihlali cezası", keywords: ["görev", "komut", "50 ceza"], effect: "penalty" },
    { name: "Etik davranış cezası", keywords: ["etik", "davranış", "ceza"], effect: "penalty", methods: ["human", "hybrid"] },
  ],
};
