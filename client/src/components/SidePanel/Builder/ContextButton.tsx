import React, { useState } from 'react';
import type { Assistant, AssistantCreateParams, AssistantsEndpoint } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import { Dialog, DialogTrigger, Label } from '~/components/ui';
import { useChatContext, useToastContext } from '~/Providers';
import { useDeleteAssistantMutation, useGetEndpointsQuery } from '~/data-provider';
import DialogTemplate from '~/components/ui/DialogTemplate';
import { useLocalize, useSetIndexOptions } from '~/hooks';
import { cn, removeFocusOutlines } from '~/utils/';
import { TrashIcon } from '~/components/svg';

export default function ContextButton({
  activeModel,
  assistant_id,
  setCurrentAssistantId,
  createMutation,
  endpoint,
}: {
  activeModel?: string;
  assistant_id: string;
  setCurrentAssistantId: React.Dispatch<React.SetStateAction<string | undefined>>;
  createMutation: UseMutationResult<Assistant, Error, AssistantCreateParams>;
  endpoint: AssistantsEndpoint;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const { setOption } = useSetIndexOptions();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  // Create a state to control the dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Check if this assistant is in the supportedIds list of any endpoint
  let isCompanyAssistant = false;

  // Check all endpoints for supportedIds that include this assistant
  if (endpointsConfig) {
    Object.entries(endpointsConfig).forEach(([_, config]) => {
      const supportedIds = (config as { supportedIds?: string[] })?.supportedIds;

      if (supportedIds?.some(id => id === assistant_id)) {
        isCompanyAssistant = true;
      }
    });
  }

  const deleteAssistant = useDeleteAssistantMutation({
    onSuccess: (_: void, vars: { assistant_id: string }, context: unknown) => {
      const updatedList = context as Assistant[] | undefined;
      if (!updatedList) {
        return;
      }

      showToast({
        message: localize('com_ui_assistant_deleted'),
        status: 'success',
      });

      if (createMutation.data?.id !== undefined) {
        createMutation.reset();
      }

      const firstAssistant = updatedList[0] as Assistant | undefined;
      if (!firstAssistant) {
        return setOption('assistant_id')('');
      }

      if (vars.assistant_id === conversation?.assistant_id) {
        return setOption('assistant_id')(firstAssistant.id);
      }

      const currentAssistant = updatedList.find(
        (assistant) => assistant.id === conversation?.assistant_id,
      );

      if (currentAssistant) {
        setCurrentAssistantId(currentAssistant.id);
      }

      setCurrentAssistantId(firstAssistant.id);
    },
    onError: (error: Error) => {
      console.error(error);
      showToast({
        message: localize('com_ui_assistant_delete_error'),
        status: 'error',
      });
    },
  });

  if (!assistant_id) {
    return null;
  }

  if (activeModel?.length === 0 || activeModel === undefined) {
    return null;
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    if (isCompanyAssistant) {
      e.preventDefault();
      e.stopPropagation();
      showToast({
        message: localize('com_ui_cannot_delete_company_assistant'),
        status: 'error',
      });
      return;
    }

    setIsDialogOpen(true);
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <button
          className={cn(
            'btn btn-neutral border-token-border-light relative h-9 rounded-lg font-medium',
            removeFocusOutlines,
            isCompanyAssistant ? 'opacity-50 cursor-not-allowed' : ''
          )}
          type="button"
          disabled={isCompanyAssistant}
          title={isCompanyAssistant ? localize('com_ui_cannot_delete_company_assistant') : ''}
          onClick={handleDeleteClick}
        >
          <div className="flex w-full items-center justify-center gap-2 text-red-500">
            <TrashIcon />
          </div>
        </button>
      </DialogTrigger>
      <DialogTemplate
        title={localize('com_ui_delete') + ' ' + localize('com_ui_assistant')}
        className="max-w-[450px]"
        main={
          <>
            <div className="flex w-full flex-col items-center gap-2">
              <div className="grid w-full items-center gap-2">
                <Label htmlFor="delete-assistant" className="text-left text-sm font-medium">
                  {localize('com_ui_delete_assistant_confirm')}
                </Label>
              </div>
            </div>
          </>
        }
        selection={{
          selectHandler: () => {
            if (!isCompanyAssistant) {
              deleteAssistant.mutate({
                assistant_id,
                model: activeModel,
                endpoint,
              });
            } else {
              showToast({
                message: localize('com_ui_cannot_delete_company_assistant'),
                status: 'error',
              });
            }
            setIsDialogOpen(false);
          },
          selectClasses: 'bg-red-600 hover:bg-red-700 dark:hover:bg-red-800 text-white',
          selectText: localize('com_ui_delete'),
        }}
      />
    </Dialog>
  );
}
