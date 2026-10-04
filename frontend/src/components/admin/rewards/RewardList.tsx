import React from 'react';

import {
  View,
  Text,
  ScrollView,
  RefreshControl,
} from 'react-native';

import RewardCard from './RewardCard';
import type { Reward } from '@/types/reward';

interface RewardListProps {
  data: Reward[];
  refreshing?: boolean;
  onRefresh?: () => void;
}

export default function RewardList({
  data,
  refreshing = false,
  onRefresh,
}: RewardListProps) {
  if (data.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-sm font-semibold text-[#666665]">
          No hay recompensas disponibles.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : undefined
      }
    >
      {data.map((reward) => (
        <RewardCard
          key={reward.id}
          id={reward.id}
          name={reward.name}
          description={reward.description ?? ''}
          points={reward.points}
          stock={reward.stock}
        />
      ))}
    </ScrollView>
  );
}