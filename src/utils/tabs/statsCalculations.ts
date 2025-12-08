// Statistical testing function for proportions/percentages
export const isSignificant = (p1: number, n1: number, p2: number, n2: number): { is95: boolean; is90: boolean } => {
  if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
  const prop1 = p1 / 100;
  const prop2 = p2 / 100;
  const pooledProp = (prop1 * n1 + prop2 * n2) / (n1 + n2);
  const se = Math.sqrt(pooledProp * (1 - pooledProp) * (1/n1 + 1/n2));
  if (se === 0) return { is95: false, is90: false };
  const z = Math.abs(prop1 - prop2) / se;
  return { is95: z > 1.96, is90: z > 1.645 && z <= 1.96 };
};

// Statistical testing function for means (two-sample z-test with pooled variance)
export const isSignificantForMeans = (
  mean1: number,
  n1: number,
  stdDev1: number,
  mean2: number,
  n2: number,
  stdDev2: number,
  confidenceLevel: 95 | 90 | 80 = 95
): { is95: boolean; is90: boolean } => {
  if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
  
  // If both standard deviations are 0 or very small, and means are equal, no significance
  const meanDiff = Math.abs(mean1 - mean2);
  if (meanDiff < 0.0001) return { is95: false, is90: false };
  
  // Use a small epsilon to avoid division by zero when standard deviations are very small
  const epsilon = 0.0001;
  const adjustedStdDev1 = Math.max(stdDev1, epsilon);
  const adjustedStdDev2 = Math.max(stdDev2, epsilon);
  
  // Calculate pooled standard deviation
  const variance1 = adjustedStdDev1 * adjustedStdDev1;
  const variance2 = adjustedStdDev2 * adjustedStdDev2;
  const pooledVariance = ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
  const pooledStdDev = Math.sqrt(Math.max(pooledVariance, epsilon * epsilon));
  
  // Standard error of the difference between means
  const se = pooledStdDev * Math.sqrt(1/n1 + 1/n2);
  if (se === 0 || se < epsilon) return { is95: false, is90: false };
  
  // Calculate z-score
  const z = meanDiff / se;
  
  // Get z-critical values based on confidence level
  const zCritical95 = confidenceLevel === 95 ? 1.96 : confidenceLevel === 90 ? 1.645 : 1.282;
  const zCritical90 = 1.645;
  
  return { 
    is95: z > zCritical95, 
    is90: z > zCritical90 && z <= zCritical95 
  };
};

