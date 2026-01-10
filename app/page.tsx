import EnvVarsSection from "./components/EnvVarsSection";

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-3 sm:p-6 font-sans">
      <main className="relative z-10 max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-8 space-y-4 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">
            Santu Hub CICD Test
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Application de test pour valider vos pipelines de déploiement continu
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-green-600 dark:text-green-400">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </div>
            <span className="font-medium">Application opérationnelle</span>
          </div>
        </div>

        {/* Environment Variables Section */}
        <EnvVarsSection />

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400 text-xs">
          <p>Déployé avec succès • Prêt pour les tests CICD</p>
        </div>
      </main>
    </div>
  );
}
