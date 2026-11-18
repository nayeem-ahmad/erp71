import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PublicNpsSurvey from './PublicNpsSurvey';

const survey = { shopName: 'Babu Bazar Store', logoUrl: null, answered: false };

describe('PublicNpsSurvey', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('asks about the shop by name and sends the chosen score with the comment', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 201 });
        render(<PublicNpsSurvey code="Ab3dE9xQ" survey={survey} />);

        expect(screen.getByRole('heading', { name: 'How likely are you to recommend Babu Bazar Store to a friend?' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Score 9 of 10' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Friendly staff ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await screen.findByText('Thank you! Your answer helps Babu Bazar Store serve you better.');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/public\/nps\/Ab3dE9xQ$/);
        expect(JSON.parse(init.body)).toEqual({ score: 9, comment: 'Friendly staff' });
    });

    it('asks for a score before sending, inline', () => {
        render(<PublicNpsSurvey code="Ab3dE9xQ" survey={survey} />);
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Choose a score from 0 to 10.');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says when the survey was already answered, or the link is not valid', async () => {
        const { unmount } = render(<PublicNpsSurvey code="x" survey={{ ...survey, answered: true }} />);
        expect(screen.getByText('This survey has already been answered. Thank you!')).toBeInTheDocument();
        unmount();

        render(<PublicNpsSurvey code="x" survey={null} />);
        expect(screen.getByText('This survey link is not valid.')).toBeInTheDocument();
    });

    it('treats a second answer as already answered', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400 });
        render(<PublicNpsSurvey code="Ab3dE9xQ" survey={survey} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Score 3 of 10' }));
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(screen.getByText('This survey has already been answered. Thank you!')).toBeInTheDocument());
    });
});
