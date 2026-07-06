import React, { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native-paper';
import { BottomSheet } from './BottomSheet';
import { DishRecipeContent } from './DishRecipeContent';
import * as api from '../services/api';
import type { DishRecipe } from '../types';
import { palette } from '../theme';
import { showAppError } from '../utils/alertMessage';
import { userFacingError } from '../utils/userFacingError';

type Props = {
  visible: boolean;
  dishId?: string;
  dishName?: string;
  onDismiss: () => void;
};

export function DishRecipeSheet({ visible, dishId, dishName, onDismiss }: Props) {
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<DishRecipe | null>(null);

  useEffect(() => {
    if (!visible || !dishId?.trim()) {
      setRecipe(null);
      return;
    }
    let active = true;
    setLoading(true);
    void api.fetchDishRecipe(dishId).then((data) => {
      if (!active) return;
      setRecipe(data);
      setLoading(false);
    }).catch((err) => {
      if (!active) return;
      setRecipe(null);
      setLoading(false);
      showAppError(userFacingError(err, 'Could not load recipe'));
    });
    return () => {
      active = false;
    };
  }, [visible, dishId]);

  const title = recipe?.title?.trim() || dishName?.trim() || 'Recipe';

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      {loading && !recipe ? (
        <ActivityIndicator color={palette.primary} style={{ marginVertical: 24 }} />
      ) : (
        <DishRecipeContent
          loading={loading}
          recipe={recipe}
          dishId={dishId}
          dishName={dishName}
        />
      )}
    </BottomSheet>
  );
}
